"""ADMIN_TOKEN write protection: every state-changing route needs X-Admin-Token, reads
and the WebSocket stay public, and an unset token keeps local development working.

The two POSTs that change nothing (/api/simulation/whatif and the explain routes) are
deliberately public — they are reads that need a request body, and they are rate-limited
in nginx instead.
"""

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

TOKEN = "s3cret-token-for-tests"
WRONG = "not-the-token"

# (method, path, json body) for every state-changing route.
WRITES = [
    ("POST", "/api/ncpor/ingest", None),
    ("POST", "/api/connection/toggle?stationId=maitri", None),
    ("POST", "/api/alerts/does-not-exist/acknowledge", {"acknowledgedBy": "tester"}),
    ("POST", "/api/logistics/update",
     {"stationId": "maitri", "itemId": "maitri-fuel", "current": 1.0, "updatedBy": "tester"}),
    ("POST", "/api/remote/dispatch",
     {"stationId": "maitri", "commandId": "gen_load_balance", "issuedBy": "tester"}),
    ("POST", "/api/admin/config",
     {"stationId": "maitri", "thresholds": {"gen_temp": {"high": {"critical": 97.0}}},
      "updatedBy": "tester"}),
    ("POST", "/api/admin/config/reset", {"stationId": "maitri", "updatedBy": "tester"}),
    ("POST", "/api/sim/inject/generator_failure?stationId=maitri", None),
    ("POST", "/api/sim/reset?stationId=maitri", None),
    ("POST", "/api/sim/mode", {"mode": "reanalysis"}),
    ("POST", "/api/sensors/batch",
     {"stationId": "maitri", "timestamp": 0, "readings": {"generator": {"gen_temp": {"value": 1.0, "unit": "C"}}}}),
]

READS = [
    "/api/health",
    "/api/stations",
    "/api/config/stations",
    "/api/station/maitri/state",
    "/api/sensors/latest?stationId=maitri",
    "/api/alerts?stationId=maitri",
    "/api/alerts/history?stationId=maitri",
    "/api/risk?stationId=maitri",
    "/api/logistics?stationId=maitri",
    "/api/admin/config?stationId=maitri",
    "/api/ncpor/live?stationId=maitri",
    "/api/connection/status?stationId=maitri",
]

# Read-only POSTs that must stay public, or a viewer could not use the dashboard.
PUBLIC_POSTS = [
    ("/api/simulation/whatif", {"stationId": "maitri", "scenarioId": "blizzard"}),
    ("/api/aurora-explain", {"stationId": "maitri", "question": "status"}),
]


def _client(temp_db, monkeypatch, token):
    """Backend with ADMIN_TOKEN set to `token` and no background tick."""
    import unified_backend as ub
    from station_store import StationStore

    monkeypatch.setattr(ub.app_config, "ADMIN_TOKEN", token)

    async def _no_tick_loop():
        await asyncio.Event().wait()

    monkeypatch.setattr(ub, "tick_loop", _no_tick_loop)
    monkeypatch.setattr(ub, "store", StationStore(ub.STATIONS, history_max_points=50))
    return TestClient(ub.app)


@pytest.fixture
def protected(temp_db, monkeypatch):
    with _client(temp_db, monkeypatch, TOKEN) as c:
        yield c


@pytest.fixture
def unprotected(temp_db, monkeypatch):
    """ADMIN_TOKEN unset — the local-development default."""
    with _client(temp_db, monkeypatch, "") as c:
        yield c


def _call(client, method, path, body, token=None):
    headers = {"X-Admin-Token": token} if token is not None else {}
    return client.request(method, path, json=body, headers=headers)


# ── Writes require the token ────────────────────────────────────────────────
@pytest.mark.parametrize(("method", "path", "body"), WRITES, ids=[w[1] for w in WRITES])
def test_write_without_a_token_is_401(protected, method, path, body):
    res = _call(protected, method, path, body)
    assert res.status_code == 401, f"{method} {path} -> {res.status_code}"
    assert "Operator login required" in res.json()["detail"]


@pytest.mark.parametrize(("method", "path", "body"), WRITES, ids=[w[1] for w in WRITES])
def test_write_with_the_wrong_token_is_401(protected, method, path, body):
    res = _call(protected, method, path, body, token=WRONG)
    assert res.status_code == 401, f"{method} {path} -> {res.status_code}"


@pytest.mark.parametrize(("method", "path", "body"), WRITES, ids=[w[1] for w in WRITES])
def test_write_with_the_right_token_passes_the_auth_check(protected, method, path, body):
    """Past authentication the route behaves normally: anything but 401 (a 404 for an
    unknown alert or a 503 for the absent simulator is the route working, not auth)."""
    res = _call(protected, method, path, body, token=TOKEN)
    assert res.status_code != 401, f"{method} {path} rejected a valid token"


def test_the_401_never_echoes_the_expected_token(protected):
    res = _call(protected, "POST", "/api/sim/reset?stationId=maitri", None, token=WRONG)
    assert TOKEN not in res.text
    assert WRONG not in res.text


def test_a_missing_and_a_wrong_token_are_indistinguishable(protected):
    missing = _call(protected, "POST", "/api/connection/toggle?stationId=maitri", None)
    wrong = _call(protected, "POST", "/api/connection/toggle?stationId=maitri", None, token=WRONG)
    assert missing.status_code == wrong.status_code == 401
    assert missing.json() == wrong.json()


# ── Reads stay public ───────────────────────────────────────────────────────
@pytest.mark.parametrize("path", READS)
def test_reads_need_no_token(protected, path):
    res = protected.get(path)
    assert res.status_code == 200, f"GET {path} -> {res.status_code}: {res.text[:160]}"


def test_head_on_health_needs_no_token(protected):
    assert protected.head("/api/health").status_code == 200


@pytest.mark.parametrize(("path", "body"), PUBLIC_POSTS, ids=[p[0] for p in PUBLIC_POSTS])
def test_read_only_posts_stay_public(protected, path, body):
    res = protected.post(path, json=body)
    assert res.status_code != 401, f"{path} must stay usable without a login"


def test_the_websocket_stays_public(protected):
    with protected.websocket_connect("/ws/station?stationId=maitri") as ws:
        assert ws.receive_json()["stationId"] == "maitri"


# ── An unset token keeps local development working ──────────────────────────
@pytest.mark.parametrize(("method", "path", "body"), WRITES, ids=[w[1] for w in WRITES])
def test_writes_work_with_no_token_configured(unprotected, method, path, body):
    res = _call(unprotected, method, path, body)
    assert res.status_code != 401, f"{method} {path} should be open when ADMIN_TOKEN is unset"


def test_a_token_is_ignored_when_none_is_configured(unprotected):
    res = _call(unprotected, "POST", "/api/connection/toggle?stationId=maitri", None, token="anything")
    assert res.status_code == 200


# ── A real end-to-end write, with and without the token ─────────────────────
def test_threshold_override_is_rejected_then_accepted(protected):
    body = {"stationId": "maitri", "thresholds": {"gen_temp": {"high": {"critical": 96.5}}},
            "updatedBy": "write-protection-test"}
    before = protected.get("/api/admin/config?stationId=maitri").json()["thresholds"]["gen_temp"]

    assert protected.post("/api/admin/config", json=body).status_code == 401
    unchanged = protected.get("/api/admin/config?stationId=maitri").json()["thresholds"]["gen_temp"]
    assert unchanged == before, "a rejected write still changed the thresholds"

    ok = protected.post("/api/admin/config", json=body, headers={"X-Admin-Token": TOKEN})
    assert ok.status_code == 200, ok.text
    after = protected.get("/api/admin/config?stationId=maitri").json()["thresholds"]["gen_temp"]
    assert after["high"]["critical"] == 96.5


def test_acknowledge_is_rejected_without_a_token(protected):
    """A real alert id, so this exercises the route rather than the 404 path. The id comes
    from the engine directly: /api/alerts reads the last published snapshot, which only
    the background tick updates (and the tick is disabled in this fixture)."""
    import unified_backend as ub

    _levels, active = ub.ALERTS.evaluate(
        "bharati", {"generator": {"gen_temp": 140.0}}, int(time.time() * 1000))
    assert active, "evaluate() did not raise an alert for an extreme generator temperature"
    alert_id = active[0]["id"]

    assert protected.post(f"/api/alerts/{alert_id}/acknowledge",
                          json={"acknowledgedBy": "nobody"}).status_code == 401
    ok = protected.post(f"/api/alerts/{alert_id}/acknowledge",
                        json={"acknowledgedBy": "operator"},
                        headers={"X-Admin-Token": TOKEN})
    assert ok.status_code == 200, ok.text
    assert ok.json()["acknowledgedBy"] == "operator"
    assert ok.json()["acknowledged"] is True

    # The acknowledgement is in the persisted history, attributed to the operator.
    history = protected.get("/api/alerts/history?stationId=bharati&limit=50").json()["alerts"]
    assert any(h["id"] == alert_id and h["acknowledgedBy"] == "operator" for h in history)
