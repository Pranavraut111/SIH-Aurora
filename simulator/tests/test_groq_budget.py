"""The outbound Groq budget: a rolling-hour cap that keeps a public demo from running up a
bill. Past the cap nothing is sent upstream and the explain path degrades to the honest
offline summary (CLAUDE.md: never present fabricated data as real).

No network: the only test that would reach Groq asserts it does not.
"""

import pytest

import simulator as sim


@pytest.fixture
def budget(monkeypatch):
    """A fresh, empty budget with a configured key, so tests are independent."""
    monkeypatch.setattr(sim, "GROQ_API_KEY", "test-key-not-used")
    monkeypatch.setattr(sim, "_groq_calls", sim.collections.deque())
    monkeypatch.setattr(sim, "_groq_cap_logged", False)
    return sim


def _set_cap(monkeypatch, n):
    monkeypatch.setattr(sim.app_config, "GROQ_MAX_CALLS_PER_HOUR", n)


def test_budget_starts_at_the_configured_cap(budget, monkeypatch):
    _set_cap(monkeypatch, 5)
    assert sim.groq_budget_remaining() == 5


def test_each_slot_consumes_exactly_one(budget, monkeypatch):
    _set_cap(monkeypatch, 3)
    assert sim._groq_take_slot() is True
    assert sim.groq_budget_remaining() == 2
    assert sim._groq_take_slot() is True
    assert sim._groq_take_slot() is True
    assert sim.groq_budget_remaining() == 0
    assert sim._groq_take_slot() is False


def test_checking_the_budget_does_not_consume_it(budget, monkeypatch):
    _set_cap(monkeypatch, 2)
    for _ in range(10):
        assert sim.groq_budget_remaining() == 2
        assert sim._llm_available() is True


def test_llm_is_unavailable_once_the_cap_is_reached(budget, monkeypatch):
    _set_cap(monkeypatch, 1)
    assert sim._llm_available() is True
    assert sim._groq_take_slot() is True
    assert sim._llm_available() is False


def test_the_window_rolls_so_the_budget_refills(budget, monkeypatch):
    _set_cap(monkeypatch, 2)
    now = 1_000_000.0
    monkeypatch.setattr(sim.time, "time", lambda: now)
    assert sim._groq_take_slot() and sim._groq_take_slot()
    assert sim._groq_take_slot() is False

    # 59 minutes later the calls are still inside the hour.
    monkeypatch.setattr(sim.time, "time", lambda: now + 59 * 60)
    assert sim.groq_budget_remaining() == 0

    # Just past the hour they expire and the budget is back.
    monkeypatch.setattr(sim.time, "time", lambda: now + 3601)
    assert sim.groq_budget_remaining() == 2
    assert sim._groq_take_slot() is True


def test_a_capped_call_never_reaches_the_network(budget, monkeypatch):
    """The cap must be enforced before any request is built, not after."""
    _set_cap(monkeypatch, 0)
    import urllib.request

    def _blow_up(*a, **kw):
        raise AssertionError("Groq was called despite the budget being used up")

    monkeypatch.setattr(urllib.request, "urlopen", _blow_up)
    out = sim._call_groq("system", "user")
    assert out == sim.LLM_CAPPED_MSG
    assert "budget" in out


def test_the_capped_message_tells_the_backend_to_use_its_offline_summary():
    """unified_backend treats an explanation starting with these prefixes as a failure and
    substitutes offline_explanation(); the capped message must match."""
    import unified_backend as ub
    assert sim.LLM_CAPPED_MSG.startswith(ub._LLM_FAILURE_PREFIXES)


def test_no_key_configured_still_reports_the_key_message(budget, monkeypatch):
    _set_cap(monkeypatch, 10)
    monkeypatch.setattr(sim, "GROQ_API_KEY", "")
    assert sim._llm_available() is False
    assert sim._call_groq("system", "user") == sim.LLM_UNAVAILABLE_MSG
    # ...and it did not spend budget to find that out.
    assert sim.groq_budget_remaining() == 10


def test_the_explain_route_reports_llm_unavailable_when_capped(budget, monkeypatch):
    """The browser-visible contract: llmAvailable goes false, which is what makes the
    backend serve its offline summary."""
    _set_cap(monkeypatch, 0)
    client = sim.control_app.test_client()
    body = client.post("/api/aurora-explain", json={"station": "maitri", "question": "status"}).get_json()
    assert body["llmAvailable"] is False
