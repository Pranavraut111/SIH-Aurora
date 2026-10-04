"""The simulator's internal LLM gateway for the assistant (/api/llm/chat): input
validation, the router's own budget, and tool-call parsing. Groq is mocked."""

import pytest

import config as app_config
import simulator as sim


@pytest.fixture
def gw(monkeypatch):
    monkeypatch.setattr(sim, "GROQ_API_KEY", "test-key-not-used")
    monkeypatch.setattr(sim, "_groq_calls", sim.collections.deque())
    monkeypatch.setattr(sim, "_router_calls", sim.collections.deque())
    monkeypatch.setattr(sim, "_llm_health", {})
    monkeypatch.setattr(sim, "_llm_probing", set())
    return sim.control_app.test_client()


class FakeResp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


def _ok(content=None, tool_calls=None):
    return FakeResp(200, {"choices": [{"message": {"content": content, "tool_calls": tool_calls}}],
                          "usage": {"prompt_tokens": 100, "completion_tokens": 20}})


def test_router_call_returns_parsed_tool_calls(gw, monkeypatch):
    sent = {}

    def post(url, json=None, **kw):
        sent.update(json)
        return _ok(tool_calls=[{"function": {"name": "navigate", "arguments": '{"module": "energy"}'}},
                               {"function": {"name": "broken", "arguments": "{not json"}}])
    monkeypatch.setattr(sim.requests, "post", post)
    r = gw.post("/api/llm/chat", json={"kind": "router", "messages": [{"role": "user", "content": "power page"}],
                                       "tools": [{"type": "function"}]}).get_json()
    assert r["available"] is True
    assert r["toolCalls"] == [{"name": "navigate", "arguments": {"module": "energy"}}]
    assert sent["model"] == sim.app_config.GROQ_ROUTER_MODEL and sent["tool_choice"] == "auto"
    assert sent["reasoning_effort"] == "low"


def test_explain_call_uses_the_explanation_model_and_json_mode(gw, monkeypatch):
    sent = {}

    def post(url, json=None, **kw):
        sent.update(json)
        return _ok(content='{"spoken": "ok"}')
    monkeypatch.setattr(sim.requests, "post", post)
    r = gw.post("/api/llm/chat", json={"kind": "explain", "json": True,
                                       "messages": [{"role": "user", "content": "q"}]}).get_json()
    assert r["content"] == '{"spoken": "ok"}'
    assert sent["model"] == sim.GROQ_MODEL and sent["response_format"] == {"type": "json_object"}


def test_router_has_its_own_budget(gw, monkeypatch):
    monkeypatch.setattr(sim.app_config, "GROQ_ROUTER_MAX_CALLS_PER_HOUR", 1)
    monkeypatch.setattr(sim.requests, "post", lambda *a, **k: _ok(content="x"))
    body = {"kind": "router", "messages": [{"role": "user", "content": "x"}]}
    assert gw.post("/api/llm/chat", json=body).get_json()["available"] is True
    capped = gw.post("/api/llm/chat", json=body).get_json()
    assert capped["available"] is False and capped["capped"] is True
    assert sim.groq_budget_remaining() > 0          # the explanation budget is untouched


def test_upstream_errors_degrade(gw, monkeypatch):
    monkeypatch.setattr(sim.requests, "post", lambda *a, **k: FakeResp(429, {"error": "rate"}))
    r = gw.post("/api/llm/chat", json={"kind": "explain", "messages": [{"role": "user", "content": "x"}]}).get_json()
    assert r["available"] is False and r["reason"] == "upstream HTTP 429"


@pytest.mark.parametrize("body", [
    {"kind": "other", "messages": [{"role": "user", "content": "x"}]},
    {"kind": "router", "messages": []},
    {"kind": "router", "messages": [{"role": "tool", "content": "x"}]},
    {"kind": "router", "messages": [{"role": "user", "content": "x" * 20000}]},
    {"kind": "router", "messages": [{"role": "user", "content": "x"}], "tools": "all"},
])
def test_gateway_rejects_bad_input(gw, body):
    assert gw.post("/api/llm/chat", json=body).status_code == 400


def test_no_key_means_unavailable(gw, monkeypatch):
    monkeypatch.setattr(sim, "GROQ_API_KEY", "")
    r = gw.post("/api/llm/chat", json={"kind": "router", "messages": [{"role": "user", "content": "x"}]}).get_json()
    assert r["available"] is False and "GROQ_API_KEY" in r["reason"]
    st = gw.get("/api/llm/status").get_json()
    assert st["configured"] is False


# ── Does Groq actually answer? (status reflects real calls + a cached probe) ──

def _chat_once(gw, kind="explain"):
    return gw.post("/api/llm/chat", json={"kind": kind, "messages": [{"role": "user", "content": "x"}]}).get_json()


def test_a_rejected_request_marks_the_model_unavailable_with_a_clear_reason(gw, monkeypatch):
    monkeypatch.setattr(sim.requests, "post", lambda *a, **k: FakeResp(400, ""))
    _chat_once(gw)
    h = sim._llm_health[sim.GROQ_MODEL]
    assert h["ok"] is False and h["reason"] == "Groq rejected the request (400)"
    monkeypatch.setattr(sim.requests, "post", lambda *a, **k: FakeResp(401, {"error": "bad key"}))
    _chat_once(gw)
    assert sim._llm_health[sim.GROQ_MODEL]["reason"] == "Groq rejected the key (401)"
    monkeypatch.setattr(sim.requests, "post", lambda *a, **k: _ok(content="fine"))
    _chat_once(gw)
    assert sim._llm_health[sim.GROQ_MODEL] == {"ok": True, "reason": None,
                                               "checkedAt": sim._llm_health[sim.GROQ_MODEL]["checkedAt"]}


def test_an_invalid_tool_call_by_the_model_does_not_mark_it_broken(gw, monkeypatch):
    body = '{"error":{"message":"Tool call validation failed","code":"tool_use_failed"}}'
    monkeypatch.setattr(sim.requests, "post", lambda *a, **k: FakeResp(400, body))
    assert _chat_once(gw, "router")["available"] is False
    assert app_config.GROQ_ROUTER_MODEL not in sim._llm_health


def test_unreachable_groq_is_reported(gw, monkeypatch):
    def boom(*a, **k):
        raise sim.requests.ConnectionError("down")
    monkeypatch.setattr(sim.requests, "post", boom)
    _chat_once(gw)
    assert sim._llm_health[sim.GROQ_MODEL]["reason"] == "Groq is unreachable from the server"


def test_status_probes_in_the_background_when_stale_and_outside_the_budget(gw, monkeypatch):
    sent = []

    def post(url, json=None, **kw):
        sent.append(json)
        return FakeResp(400, "")
    monkeypatch.setattr(sim.requests, "post", post)
    st = gw.get("/api/llm/status").get_json()
    assert st["explainHealth"]["ok"] is None            # first call: never blocks on the probe
    for t in [t for t in sim.threading.enumerate() if t.name.startswith("llm-probe-")]:
        t.join(5)
    st = gw.get("/api/llm/status").get_json()
    assert st["explainHealth"] == {**st["explainHealth"], "ok": False, "reason": "Groq rejected the request (400)"}
    assert st["routerHealth"]["ok"] is False
    assert {b["model"] for b in sent} == {sim.GROQ_MODEL, app_config.GROQ_ROUTER_MODEL}
    assert all(b["max_tokens"] <= 32 for b in sent)
    assert len(sim._groq_calls) == 0 and len(sim._router_calls) == 0     # probes spend no budget slot
    gw.get("/api/llm/status")                           # fresh record → no new probe
    assert not [t for t in sim.threading.enumerate() if t.name.startswith("llm-probe-")]
    assert len(sent) == 2


def test_a_stale_record_is_reprobed(gw, monkeypatch):
    monkeypatch.setattr(sim.requests, "post", lambda *a, **k: _ok(content="OK"))
    sim._note_llm_result(sim.GROQ_MODEL, False, "Groq rejected the request (400)")
    sim._llm_health[sim.GROQ_MODEL]["checkedAt"] -= app_config.GROQ_PROBE_INTERVAL_S + 1
    assert sim.llm_health(sim.GROQ_MODEL)["ok"] is False    # stale value returned, probe started
    for t in [t for t in sim.threading.enumerate() if t.name.startswith("llm-probe-")]:
        t.join(5)
    assert sim.llm_health(sim.GROQ_MODEL)["ok"] is True


def test_no_key_health_needs_no_probe(gw, monkeypatch):
    monkeypatch.setattr(sim, "GROQ_API_KEY", "")
    assert sim.llm_health(sim.GROQ_MODEL) == {"ok": False, "reason": "no Groq key on the server", "checkedAt": None}


@pytest.mark.parametrize("raw", ['gsk_abc123', ' gsk_abc123 ', '"gsk_abc123"', "'gsk_abc123'",
                                 'gsk_abc123\r', '"gsk_abc123"\r\n', 'gsk_abc 123', '\tgsk_abc123\n'])
def test_the_groq_key_is_cleaned_of_quotes_and_whitespace(monkeypatch, raw):
    monkeypatch.setenv("GROQ_API_KEY", raw)
    assert app_config._get_secret("GROQ_API_KEY") == "gsk_abc123"


def test_an_unset_secret_uses_the_default(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "  ")
    assert app_config._get_secret("GROQ_API_KEY") == ""
