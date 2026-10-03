"""Judge mode: the visitor sandbox (VISITOR_SANDBOX) and public demo scenarios (PUBLIC_DEMO).

What must hold on the public deployment, where judges visit unaccompanied:
- an anonymous write is validated like a real one, lands only in that visitor's sandbox,
  is visible only to that visitor, and never reaches the shared state;
- two visitors' sandboxes are isolated; sessions expire; a visitor can reset theirs;
- the team's ADMIN_TOKEN still writes the shared state; team-only routes stay 401;
- anyone may run one predefined scenario per station at a time, with a per-IP cooldown
  (429, friendly message), and it resets itself after PUBLIC_DEMO_DURATION_S.
"""

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

TOKEN = "judge-mode-team-token"


@pytest.fixture
def judge(temp_db, monkeypatch):
    """Backend as deployed for judges: protected, sandbox + public demo on, no tick, fake simulator."""
    import judge_mode

    import unified_backend as ub
    from station_store import StationStore

    monkeypatch.setattr(ub.app_config, "ADMIN_TOKEN", TOKEN)
    monkeypatch.setattr(ub.app_config, "VISITOR_SANDBOX", True)
    monkeypatch.setattr(ub.app_config, "PUBLIC_DEMO", True)

    async def _no_tick_loop():
        await asyncio.Event().wait()

    monkeypatch.setattr(ub, "tick_loop", _no_tick_loop)
    monkeypatch.setattr(ub, "store", StationStore(ub.STATIONS, history_max_points=50))
    monkeypatch.setattr(judge_mode, "DEMO", judge_mode.PublicDemo())
    monkeypatch.setattr(ub, "DEMO", judge_mode.DEMO)
    monkeypatch.setattr(judge_mode, "SANDBOX", judge_mode.SandboxStore())
    monkeypatch.setattr(ub, "SANDBOX", judge_mode.SANDBOX)

    calls = []

    def fake_sim(method, path, *, params=None, json_body=None, timeout=None):
        calls.append((method, path, dict(params or {})))
        if path.startswith("/inject/"):
            return {"scenario": path.split("/")[-1], "name": "Generator Failure", "station": params["station"],
                    "duration": float(params.get("duration", 30)), "source": params.get("source", "team")}
        return {"status": "reset", "station": params["station"]}

    monkeypatch.setattr(ub, "_sim_request", fake_sim)
    with TestClient(ub.app) as a, TestClient(ub.app) as b:
        yield {"a": a, "b": b, "ub": ub, "calls": calls}


def _fuel(client):
    items = client.get("/api/logistics?stationId=maitri").json()["items"]
    return next(i for i in items if i["id"] == "maitri-fuel")


def _shared_fuel_current():
    import db
    with db.connect() as conn:
        return conn.execute("SELECT current FROM logistics_inventory WHERE id = 'maitri-fuel'").fetchone()[0]


def _ledger(client, value, by="Judge A"):
    return client.post("/api/logistics/update", json={"stationId": "maitri", "itemId": "maitri-fuel",
                                                     "current": value, "updatedBy": by})


# ── Sandbox: isolation, no leak, expiry ───────────────────────

def test_session_reports_judge_mode(judge):
    body = judge["a"].get("/api/admin/session").json()
    assert body["writeProtected"] is True and body["authenticated"] is False
    assert body["sandbox"] is True and body["publicDemo"] is True and body["sandboxTtlS"] == 3600


def test_a_visitor_ledger_edit_is_private_and_never_reaches_the_shared_state(judge):
    a, b = judge["a"], judge["b"]
    shared_before = _shared_fuel_current()
    r = _ledger(a, 1234.0)
    assert r.status_code == 200 and r.json()["sandbox"] is True
    assert "aurora_sandbox" in r.cookies                       # the session is created on the first write
    assert r.headers.get("x-sandbox-created") == "1"
    # Visitor A sees their value, marked sandbox; B and the shared table do not.
    assert _fuel(a)["current"] == 1234.0 and _fuel(a)["sandbox"] is True
    assert _fuel(b)["current"] == shared_before and _fuel(b)["sandbox"] is False
    assert _shared_fuel_current() == shared_before
    # The audit trail is private too.
    hist_a = a.get("/api/logistics/history?stationId=maitri").json()["history"]
    hist_b = b.get("/api/logistics/history?stationId=maitri").json()["history"]
    assert any(h["sandbox"] and h["newValue"] == "1234.0" for h in hist_a)
    assert not any(h.get("sandbox") for h in hist_b)


def test_two_visitors_have_separate_sandboxes(judge):
    a, b = judge["a"], judge["b"]
    _ledger(a, 1111.0)
    _ledger(b, 2222.0, by="Judge B")
    assert _fuel(a)["current"] == 1111.0
    assert _fuel(b)["current"] == 2222.0
    assert a.cookies.get("aurora_sandbox") != b.cookies.get("aurora_sandbox")


def test_what_if_uses_the_visitors_own_ledger(judge):
    a, b, ub = judge["a"], judge["b"], judge["ub"]
    ub.tick_station("maitri")                                   # a published snapshot to run against
    _ledger(a, 500.0)
    body = {"stationId": "maitri", "scenarioId": "fuel_leak", "intensity": 1.0}
    mine = a.post("/api/simulation/whatif", json=body).json()
    theirs = b.post("/api/simulation/whatif", json=body).json()
    assert mine != theirs                                       # A's autonomy uses A's 500 L, B's the shared stock
    assert "500" in str(mine)


def test_sandbox_writes_are_validated_exactly_like_real_ones(judge):
    a = judge["a"]
    over = _ledger(a, 10 ** 8)                                  # above the tank's max capacity
    assert over.status_code == 422 and "exceeds max capacity" in str(over.json())
    unknown = a.post("/api/logistics/update", json={"stationId": "maitri", "itemId": "nope", "current": 1.0,
                                                    "updatedBy": "Judge"})
    assert unknown.status_code == 404
    extra = a.post("/api/logistics/update", json={"stationId": "maitri", "itemId": "maitri-fuel", "current": 1.0,
                                                  "updatedBy": "Judge", "sneaky": 1})
    assert extra.status_code == 422
    bad_th = a.post("/api/admin/config", json={"stationId": "maitri", "updatedBy": "Judge",
                                               "thresholds": {"gen_temp": {"high": {"warning": 120.0}}}})
    assert bad_th.status_code == 422                            # warning ≥ critical is refused, as for the team
    bad_cmd = a.post("/api/remote/dispatch", json={"stationId": "maitri", "subsystem": "Power Grid",
                                                   "command": "SELF_DESTRUCT", "issuedBy": "Judge"})
    assert bad_cmd.status_code == 422


def test_sandbox_thresholds_commands_and_acks_stay_private(judge):
    a, b, ub = judge["a"], judge["b"], judge["ub"]
    import alert_engine
    import db
    shared_overrides = alert_engine.load_overrides("maitri")
    r = a.post("/api/admin/config", json={"stationId": "maitri", "updatedBy": "Judge",
                                          "thresholds": {"gen_temp": {"high": {"critical": 97.0}}}})
    assert r.status_code == 200 and r.json()["sandbox"] is True
    assert a.get("/api/admin/config?stationId=maitri").json()["thresholds"]["gen_temp"]["high"]["critical"] == 97.0
    assert b.get("/api/admin/config?stationId=maitri").json()["thresholds"]["gen_temp"]["high"]["critical"] != 97.0
    assert alert_engine.load_overrides("maitri") == shared_overrides
    assert a.post("/api/admin/config/reset", json={"stationId": "maitri", "updatedBy": "Judge"}).json()["removed"] == 1

    cmd = a.post("/api/remote/dispatch", json={"stationId": "maitri", "subsystem": "Power Grid",
                                               "command": "ENGAGE_BACKUP_GENSET_RUN", "issuedBy": "Judge"})
    assert cmd.status_code == 200 and cmd.json()["sandbox"] is True
    ids_a = {c["id"] for c in a.get("/api/remote/commands?stationId=maitri").json()["commands"]}
    ids_b = {c["id"] for c in b.get("/api/remote/commands?stationId=maitri").json()["commands"]}
    assert cmd.json()["commandId"] in ids_a and cmd.json()["commandId"] not in ids_b
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM remote_commands").fetchone()[0] == 0

    # An open alert, acknowledged in A's sandbox only.
    ub.ALERTS.evaluate("maitri", {"generator": {"gen_temp": 150.0}}, int(time.time() * 1000))
    open_alerts = [ub.ALERTS._public(x, {}) for x in ub.ALERTS._open["maitri"].values()]
    ub.store.publish("maitri", {"stationId": "maitri", "activeAlerts": open_alerts,
                                "alerts": {}, "dependencyAlerts": [], "dataSource": "simulator"})
    alert_id = next(iter(ub.ALERTS._open["maitri"].values()))["id"]
    ack = a.post(f"/api/alerts/{alert_id}/acknowledge", json={"acknowledgedBy": "Judge A"})
    assert ack.status_code == 200 and ack.json()["sandbox"] is True
    mine = a.get("/api/alerts?stationId=maitri").json()["activeAlerts"]
    theirs = b.get("/api/alerts?stationId=maitri").json()["activeAlerts"]
    assert all(x["acknowledged"] for x in mine if x["id"] == alert_id)
    assert not any(x["acknowledged"] for x in theirs if x["id"] == alert_id)
    with db.connect() as conn:
        row = conn.execute("SELECT acknowledged_by FROM station_alerts WHERE id = ?", (alert_id,)).fetchone()
        assert row[0] is None
    assert a.post("/api/alerts/nope/acknowledge", json={"acknowledgedBy": "Judge"}).status_code == 404


def _publish_gen_temp(ub, value, alerts=()):
    ub.store.publish("maitri", {"stationId": "maitri", "timestamp": int(time.time() * 1000),
                                "sensors": {"generator": {"gen_temp": value}}, "activeAlerts": list(alerts),
                                "alerts": {}, "dependencyAlerts": [], "aiHealth": "healthy",
                                "dataSource": "simulator"})


def _set_gen_temp(client, **levels):
    r = client.post("/api/admin/config", json={"stationId": "maitri", "updatedBy": "Judge",
                                               "thresholds": {"gen_temp": {"high": levels}}})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_visitors_own_thresholds_drive_only_their_own_alerts(judge):
    """Shared reading 80 °C is normal (warning 88). Visitor A lowers the warning to 70:
    A alone sees a warning alert, a degraded generator, the cascade and the health; the
    shared alerts, the database and visitor B are unchanged."""
    a, b, ub = judge["a"], judge["b"], judge["ub"]
    import db
    _publish_gen_temp(ub, 80.0)
    body = _set_gen_temp(a, warning=70.0)
    assert body["sandbox"] is True and body["thresholdsUsedByAlerts"] is True and body["alertsScope"] == "sandbox"

    mine = a.get("/api/alerts?stationId=maitri").json()
    assert [x["sensor"] for x in mine["activeAlerts"]] == ["gen_temp"]
    alert = mine["activeAlerts"][0]
    assert alert["level"] == "warning" and alert["threshold"] == 70.0 and alert["sandbox"] is True
    assert alert["id"].startswith("SBX-maitri-gen_temp-") and "your sandbox threshold" in alert["message"]
    assert mine["alerts"]["generator"] == "warning"
    assert any(d["sourceBuilding"] == "generator" for d in mine["dependencyAlerts"])
    state = a.get("/api/station/maitri/state").json()
    assert state["aiHealth"] == "warning" and state["sandboxThresholds"] == ["gen_temp"]

    theirs = b.get("/api/alerts?stationId=maitri").json()
    assert theirs["activeAlerts"] == [] and theirs["dependencyAlerts"] == []
    assert ub.store.get_published("maitri")["activeAlerts"] == []
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM station_alerts").fetchone()[0] == 0

    # The id and start time are stable between reads, it is in A's history, and A can acknowledge it.
    assert a.get("/api/alerts?stationId=maitri").json()["activeAlerts"][0]["id"] == alert["id"]
    hist = a.get("/api/alerts/history?stationId=maitri").json()["alerts"]
    assert hist[0]["id"] == alert["id"] and hist[0]["sandbox"] is True
    assert b.get("/api/alerts/history?stationId=maitri").json()["alerts"] == []
    ack = a.post(f"/api/alerts/{alert['id']}/acknowledge", json={"acknowledgedBy": "Judge A"})
    assert ack.status_code == 200 and ack.json()["sandbox"] is True
    assert a.get("/api/alerts?stationId=maitri").json()["activeAlerts"][0]["acknowledged"] is True
    # B cannot acknowledge A's private alert; it does not exist for B.
    assert b.post(f"/api/alerts/{alert['id']}/acknowledge", json={"acknowledgedBy": "Judge B"}).status_code == 404

    # The reading drops below A's threshold → A's alert clears; resetting brings back the shared view.
    _publish_gen_temp(ub, 60.0)
    assert a.get("/api/alerts?stationId=maitri").json()["activeAlerts"] == []
    _publish_gen_temp(ub, 80.0)
    assert a.post("/api/admin/config/reset", json={"stationId": "maitri", "updatedBy": "Judge"}).status_code == 200
    assert a.get("/api/alerts?stationId=maitri").json()["activeAlerts"] == []


def test_a_visitor_can_raise_a_threshold_above_a_live_alert(judge):
    """A shared critical alert at 150 °C; A raises critical to 140 and warning to 139:
    A's view shows their own critical (at 140), never the shared one twice; B keeps the shared alert."""
    a, b, ub = judge["a"], judge["b"], judge["ub"]
    ub.ALERTS.evaluate("maitri", {"generator": {"gen_temp": 120.0}}, int(time.time() * 1000))
    shared = [ub.ALERTS._public(x, {}) for x in ub.ALERTS._open["maitri"].values()]
    _publish_gen_temp(ub, 120.0, shared)
    assert [x["id"] for x in b.get("/api/alerts?stationId=maitri").json()["activeAlerts"]] == [shared[0]["id"]]
    _set_gen_temp(a, warning=130.0, critical=140.0)
    assert a.get("/api/alerts?stationId=maitri").json()["activeAlerts"] == []        # 120 is normal for A
    assert a.get("/api/alerts?stationId=maitri").json()["alerts"]["generator"] == "normal"
    assert [x["id"] for x in b.get("/api/alerts?stationId=maitri").json()["activeAlerts"]] == [shared[0]["id"]]


def test_the_live_stream_carries_the_visitors_own_alerts(judge):
    a, b, ub = judge["a"], judge["b"], judge["ub"]
    _publish_gen_temp(ub, 80.0)
    _set_gen_temp(a, warning=70.0)
    with a.websocket_connect("/ws/station?stationId=maitri") as ws:
        assert [x["sensor"] for x in ws.receive_json()["activeAlerts"]] == ["gen_temp"]
    with b.websocket_connect("/ws/station?stationId=maitri") as ws:
        assert ws.receive_json()["activeAlerts"] == []


def test_alert_start_times_go_with_the_session(judge):
    import judge_mode
    a, ub = judge["a"], judge["ub"]
    _publish_gen_temp(ub, 80.0)
    _set_gen_temp(a, warning=70.0)
    a.get("/api/alerts?stationId=maitri")
    assert len(judge_mode.SANDBOX._alert_since) == 1
    a.post("/api/sandbox/reset")
    assert judge_mode.SANDBOX._alert_since == {}
    # A session removed by another process (the nightly reset) is forgotten at the next cleanup.
    _set_gen_temp(a, warning=70.0)
    a.get("/api/alerts?stationId=maitri")
    import db
    with db.connect() as conn:
        conn.execute("DELETE FROM sandbox_sessions")
    judge_mode.SANDBOX.cleanup()
    assert judge_mode.SANDBOX._alert_since == {} and judge_mode.SANDBOX._writes == {}


def test_reset_my_sandbox_forgets_everything(judge):
    a = judge["a"]
    shared = _shared_fuel_current()
    _ledger(a, 999.0)
    assert a.get("/api/sandbox").json()["changes"]["ledger"] == 1
    r = a.post("/api/sandbox/reset")
    assert r.status_code == 200 and r.json()["removed"] >= 1
    assert _fuel(a)["current"] == shared
    assert a.get("/api/sandbox").json()["active"] is False


def test_sessions_expire_and_are_cleaned_up(judge, monkeypatch):
    a = judge["a"]
    import judge_mode

    import db
    _ledger(a, 777.0)
    assert _fuel(a)["current"] == 777.0
    with db.connect() as conn:                                  # an hour passes
        conn.execute("UPDATE sandbox_sessions SET expires_at = ?", (judge_mode.now_ms() - 1,))
    assert _fuel(a)["current"] != 777.0                         # an expired session is ignored
    assert judge_mode.SANDBOX.cleanup() == 1
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM sandbox_changes").fetchone()[0] == 0


def test_the_sandbox_is_capped_and_rate_limited(judge, monkeypatch):
    a, b = judge["a"], judge["b"]
    ub = judge["ub"]
    monkeypatch.setattr(ub.app_config, "SANDBOX_MAX_SESSIONS", 1)
    assert _ledger(a, 1.0).status_code == 200
    full = _ledger(b, 2.0)
    assert full.status_code == 503 and "sandbox is full" in full.json()["detail"]
    monkeypatch.setattr(ub.app_config, "SANDBOX_WRITES_PER_MIN", 3)
    codes = [_ledger(a, float(i)).status_code for i in range(5)]
    assert 429 in codes and "Retry-After" in _ledger(a, 9.0).headers


def test_the_team_token_still_writes_the_shared_state(judge):
    a = judge["a"]
    r = a.post("/api/logistics/update", headers={"X-Admin-Token": TOKEN},
               json={"stationId": "maitri", "itemId": "maitri-fuel", "current": 4321.0, "updatedBy": "Team"})
    assert r.status_code == 200 and "sandbox" not in r.json()
    assert _shared_fuel_current() == 4321.0
    wrong = a.post("/api/logistics/update", headers={"X-Admin-Token": "nope"},
                   json={"stationId": "maitri", "itemId": "maitri-fuel", "current": 1.0, "updatedBy": "x"})
    assert wrong.status_code == 401


@pytest.mark.parametrize("method, path, body", [
    ("POST", "/api/sim/mode", {"mode": "reanalysis"}),
    ("POST", "/api/ncpor/ingest", None),
    ("POST", "/api/connection/toggle?stationId=maitri", None),
    ("POST", "/api/sensors/batch",
     {"stationId": "maitri", "timestamp": 0, "readings": {"generator": {"gen_temp": {"value": 1.0, "unit": "C"}}}}),
])
def test_team_only_routes_still_need_the_token(judge, method, path, body):
    assert judge["a"].request(method, path, json=body).status_code == 401


# ── Public demo scenarios ────────────────────────────────────

def test_a_visitor_can_run_a_demo_scenario_for_two_minutes(judge):
    a = judge["a"]
    r = a.post("/api/sim/inject/generator_failure?stationId=maitri")
    assert r.status_code == 200
    rec = r.json()["publicDemo"]
    assert rec["startedBy"] == "visitor" and rec["simulated"] is True
    assert rec["endsAt"] - rec["startedAt"] == 120_000
    assert judge["calls"][-1] == ("POST", "/inject/generator_failure",
                                  {"station": "maitri", "duration": 120, "source": "public-demo"})


def test_one_scenario_per_station_and_a_friendly_cooldown(judge):
    a, b, ub = judge["a"], judge["b"], judge["ub"]
    assert a.post("/api/sim/inject/blizzard?stationId=maitri").status_code == 200
    busy = b.post("/api/sim/inject/co2_spike?stationId=maitri", headers={"X-Real-IP": "10.9.9.9"})
    assert busy.status_code == 409
    assert "Another scenario is running at Maitri; try again in" in busy.json()["detail"]["message"]
    # Same visitor (same IP) on the other station within the cooldown: 429 with a friendly message.
    cool = a.post("/api/sim/inject/water_crisis?stationId=bharati")
    assert cool.status_code == 429
    assert "you can start another in" in cool.json()["detail"]["message"]
    assert int(cool.headers["Retry-After"]) > 0
    # A different visitor may use the other station.
    other = b.post("/api/sim/inject/water_crisis?stationId=bharati", headers={"X-Real-IP": "10.8.8.8"})
    assert other.status_code == 200
    # Only the predefined scenarios are public.
    assert ub.judge_mode.PUBLIC_SCENARIOS == ("generator_failure", "heating_failure", "blizzard", "water_crisis",
                                              "co2_spike", "link_loss")
    assert b.post("/api/sim/inject/not_a_demo?stationId=maitri", headers={"X-Real-IP": "10.7.7.7"}).status_code == 403


def test_demo_scenarios_reset_themselves_after_two_minutes(judge):
    a, ub = judge["a"], judge["ub"]
    import judge_mode
    a.post("/api/sim/inject/heating_failure?stationId=bharati")
    assert judge_mode.DEMO.due() == []
    assert judge_mode.DEMO.due(judge_mode.now_ms() + 121_000) == ["bharati"]
    # The tick resets due scenarios through the simulator and frees the station.
    judge_mode.DEMO.active["bharati"]["endsAt"] = judge_mode.now_ms() - 1
    asyncio.run(ub.run_tick())
    assert ("POST", "/reset", {"station": "bharati", "source": "public-demo-auto"}) in judge["calls"]
    assert judge_mode.DEMO.get("bharati") is None


def test_the_running_scenario_is_published_to_every_visitor(judge):
    a, b, ub = judge["a"], judge["b"], judge["ub"]
    a.post("/api/sim/inject/co2_spike?stationId=maitri")
    ub.tick_station("bharati")                                  # any station's snapshot carries it
    demo = b.get("/api/station/bharati/state").json()["publicDemo"]
    assert demo["maitri"]["scenario"] == "co2_spike" and demo["maitri"]["startedBy"] == "visitor"
    assert 0 < demo["maitri"]["remainingS"] <= 120


def test_visitors_may_reset_only_a_public_demo(judge):
    a, b = judge["a"], judge["b"]
    team = a.post("/api/sim/inject/blizzard?stationId=maitri", headers={"X-Admin-Token": TOKEN})
    assert team.status_code == 200 and team.json()["publicDemo"]["startedBy"] == "team"
    assert b.post("/api/sim/reset?stationId=maitri").status_code == 403
    assert a.post("/api/sim/reset?stationId=maitri", headers={"X-Admin-Token": TOKEN}).status_code == 200
    assert b.post("/api/sim/inject/blizzard?stationId=maitri").status_code == 200
    assert b.post("/api/sim/reset?stationId=maitri").status_code == 200
    assert b.post("/api/sim/reset?stationId=maitri").json()["status"] == "idle"


def test_public_demo_off_means_injection_still_needs_the_token(judge, monkeypatch):
    monkeypatch.setattr(judge["ub"].app_config, "PUBLIC_DEMO", False)
    assert judge["a"].post("/api/sim/inject/blizzard?stationId=maitri").status_code == 401


def test_identical_explanations_are_served_from_a_short_cache(judge, monkeypatch):
    """Several judges asking the same thing at once cost one LLM call."""
    ub = judge["ub"]
    calls = []

    def fake_sim(method, path, *, params=None, json_body=None, timeout=None):
        calls.append(path)
        return {"explanation": "Storm conditions; suspend outdoor work.", "llmAvailable": True}

    monkeypatch.setattr(ub, "_sim_request", fake_sim)
    monkeypatch.setattr(ub, "_explain_cache", {})
    body = {"stationId": "maitri", "question": "status", "freeText": "What should we do?"}
    first = judge["a"].post("/api/aurora-explain", json=body).json()
    second = judge["b"].post("/api/aurora-explain", json={**body, "freeText": "  what SHOULD we do? "}).json()
    assert first["mode"] == "llm" and "cached" not in first
    assert second["cached"] is True and second["explanation"] == first["explanation"]
    assert calls == ["/api/aurora-explain"]
    other = judge["a"].post("/api/aurora-explain", json={**body, "stationId": "bharati"}).json()
    assert "cached" not in other and calls.count("/api/aurora-explain") == 2
