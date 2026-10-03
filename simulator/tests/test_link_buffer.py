"""Simulated satellite link loss with store-and-forward (link_buffer.py + the tick).

What must hold:
- while the link is down, readings are held in the station-side buffer (one per reading
  timestamp, sized from their JSON) and nothing new is published or added to history;
- on restore the buffered readings are evaluated and published in order: the history has
  no gap, an alert during the outage carries its real timestamp, and a summary is recorded;
- the public demo 'link_loss' follows the same rules as the other scenarios and restores
  itself; the team toggle still needs the token.
"""

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

TOKEN = "link-team-token"


def test_the_buffer_dedupes_caps_and_counts_bytes():
    from link_buffer import LinkBuffer, payload_bytes
    lb = LinkBuffer(["maitri"], max_readings=3)
    assert lb.cut("maitri", "team", 1000) is True and lb.cut("maitri", "team", 1000) is False
    for ts in (1, 2, 2, 3, 4, 5):                       # one duplicate timestamp, then past the cap
        lb.hold("maitri", {"ts_ms": ts, "sensors": {"x": {"y": ts}}})
    st = lb.status("maitri")
    assert st["bufferedReadings"] == 3 and st["droppedReadings"] == 2
    assert st["oldestBuffered"] == 3 and st["newestBuffered"] == 5
    assert st["bufferedBytes"] == sum(payload_bytes({"ts_ms": t, "sensors": {"x": {"y": t}}}) for t in (3, 4, 5))
    assert lb.request_restore("maitri") is True and lb.is_down("maitri") is False and lb.restore_due("maitri")
    readings, meta = lb.take("maitri")
    assert [r["ts_ms"] for r in readings] == [3, 4, 5] and meta["dropped"] == 2
    assert lb.status("maitri")["up"] is True and lb.status("maitri")["bufferedReadings"] == 0


@pytest.fixture
def backend(temp_db, monkeypatch):
    """Backend with no background tick and no simulator: ticks run the physics fallback."""
    import judge_mode

    import unified_backend as ub
    from station_store import StationStore

    async def _no_tick_loop():
        await asyncio.Event().wait()

    monkeypatch.setattr(ub, "tick_loop", _no_tick_loop)
    monkeypatch.setattr(ub, "store", StationStore(ub.STATIONS, history_max_points=200))
    monkeypatch.setattr(judge_mode, "DEMO", judge_mode.PublicDemo())
    monkeypatch.setattr(ub, "DEMO", judge_mode.DEMO)
    calls = []

    def fake_sim(method, path, *, params=None, json_body=None, timeout=None):
        calls.append((method, path, dict(params or {})))
        return {"scenarios": {"co2_spike": {"name": "CO2 spike"}}} if path == "/scenarios" else {"status": "ok"}

    monkeypatch.setattr(ub, "_sim_request", fake_sim)
    ub.sim_calls = calls
    with TestClient(ub.app) as c:
        yield c, ub


def _ticks(ub, n, sid="maitri"):
    for _ in range(n):
        time.sleep(0.003)                               # distinct reading timestamps (ms)
        ub.tick_station(sid)


def _history(client, key="generator.gen_temp"):
    body = client.get(f"/api/history?stationId=maitri&keys={key}&minutes=30").json()
    return body["series"][key]


def test_link_loss_buffers_then_syncs_in_order_with_alerts_at_their_real_time(backend):
    client, ub = backend
    import alert_engine
    import db
    _ticks(ub, 2)
    before = client.get("/api/station/maitri/state").json()
    hist_before = _history(client)

    assert client.post("/api/connection/toggle?stationId=maitri").json()["connected"] is False
    # During the outage a warning threshold below the reading is set: the alert happens
    # "on site" during the outage and must reach the dashboard with that time.
    temp = before["sensors"]["generator"]["gen_temp"]
    alert_engine.save_overrides("maitri", {"gen_temp": {"high": {"warning": max(40.0, temp - 5)}}}, "test")
    _ticks(ub, 5)
    frozen = client.get("/api/station/maitri/state").json()
    assert frozen["timestamp"] == before["timestamp"]               # the last data received
    assert frozen["connected"] is False and frozen["link"]["up"] is False
    assert frozen["link"]["bufferedReadings"] == 5 and frozen["link"]["bufferedBytes"] > 1000
    assert frozen["link"]["lastContact"] == before["timestamp"]
    assert not [a for a in frozen["activeAlerts"] if a["sensor"] == "gen_temp"]
    assert _history(client) == hist_before                          # nothing new published
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM station_alerts").fetchone()[0] == 0
    buffered_first = frozen["link"]["oldestBuffered"]

    assert client.post("/api/connection/toggle?stationId=maitri").json()["connected"] is True
    _ticks(ub, 1)                                                   # the sync happens on the tick
    after = client.get("/api/station/maitri/state").json()
    assert after["link"]["up"] is True and after["link"]["bufferedReadings"] == 0
    hist = _history(client)
    times = [t for t, _ in hist]
    assert times == sorted(times) and len(hist) == len(hist_before) + 5 + 1     # no gap: 5 buffered + 1 live
    alert = next(a for a in after["activeAlerts"] if a["sensor"] == "gen_temp")
    assert alert["timestamp"] == buffered_first                     # raised at its real (outage) time
    sync = after["link"]["lastSync"]
    assert sync["readings"] == 5 and sync["alertsRaised"] == 1 and sync["bytes"] > 1000
    assert sync["message"].startswith("Link restored: 5 readings (")
    assert "1 alert raised during the outage" in sync["message"]
    assert any(e["message"] == sync["message"] for e in after["eventTimeline"])
    assert after["link"]["syncs"] == 1


def test_the_team_toggle_needs_the_token_and_status_is_public(backend, monkeypatch):
    client, ub = backend
    monkeypatch.setattr(ub.app_config, "ADMIN_TOKEN", TOKEN)
    assert client.post("/api/connection/toggle?stationId=maitri").status_code == 401
    assert client.get("/api/connection/status?stationId=maitri").json()["link"]["up"] is True
    r = client.post("/api/connection/toggle?stationId=maitri", headers={"X-Admin-Token": TOKEN})
    assert r.json()["connected"] is False
    # The team's outage shows in the shared banner too, on every station's snapshot.
    _ticks(ub, 1, "bharati")
    assert client.get("/api/station/bharati/state").json()["publicDemo"]["maitri"]["scenario"] == "link_loss"


def test_visitors_can_run_link_loss_as_a_public_demo_that_restores_itself(backend, monkeypatch):
    client, ub = backend
    import judge_mode
    monkeypatch.setattr(ub.app_config, "ADMIN_TOKEN", TOKEN)
    monkeypatch.setattr(ub.app_config, "PUBLIC_DEMO", True)
    _ticks(ub, 1, "bharati")
    r = client.post("/api/sim/inject/link_loss?stationId=bharati")
    assert r.status_code == 200 and r.json()["name"] == "Satellite link loss"
    assert client.get("/api/connection/status?stationId=bharati").json()["link"]["startedBy"] == "visitor"
    # One at a time per station, cooldown per visitor, like every demo scenario.
    other = client.post("/api/sim/inject/blizzard?stationId=bharati", headers={"X-Real-IP": "10.1.1.1"})
    assert other.status_code == 409
    assert client.post("/api/sim/inject/blizzard?stationId=maitri").status_code == 429
    _ticks(ub, 3, "bharati")
    assert client.get("/api/station/bharati/state").json()["link"]["bufferedReadings"] == 3
    # Not a simulator scenario: the "simulator no longer runs it" check must not end it.
    judge_mode.DEMO.active["bharati"]["startedAt"] -= 60_000
    _ticks(ub, 1, "bharati")
    assert judge_mode.DEMO.get("bharati")["scenario"] == "link_loss"
    # After 120 s the tick restores the link and frees the station.
    judge_mode.DEMO.active["bharati"]["endsAt"] = judge_mode.now_ms() - 1
    asyncio.run(ub.run_tick())                          # ends the demo and asks for the restore
    _ticks(ub, 1, "bharati")                            # the next tick syncs (≤ one tick later)
    state = client.get("/api/station/bharati/state").json()
    assert judge_mode.DEMO.get("bharati") is None
    assert state["link"]["up"] is True and state["link"]["lastSync"]["readings"] >= 4


def test_a_visitor_can_end_their_link_loss_early(backend, monkeypatch):
    client, ub = backend
    monkeypatch.setattr(ub.app_config, "ADMIN_TOKEN", TOKEN)
    monkeypatch.setattr(ub.app_config, "PUBLIC_DEMO", True)
    _ticks(ub, 1)
    client.post("/api/sim/inject/link_loss?stationId=maitri")
    _ticks(ub, 2)
    r = client.post("/api/sim/reset?stationId=maitri")
    assert r.status_code == 200 and r.json()["scenario"] == "link_loss"
    _ticks(ub, 1)
    assert client.get("/api/station/maitri/state").json()["link"]["lastSync"]["readings"] == 2


def test_the_link_demo_raises_an_on_site_fault_and_clears_it(backend, monkeypatch):
    client, ub = backend
    monkeypatch.setattr(ub.app_config, "ADMIN_TOKEN", TOKEN)
    monkeypatch.setattr(ub.app_config, "PUBLIC_DEMO", True)
    _ticks(ub, 1, "bharati")
    scenarios = client.get("/api/sim/scenarios?stationId=bharati").json()
    assert scenarios["scenarios"]["link_loss"]["kind"] == "link" and "activeScenario" not in scenarios
    client.post("/api/sim/inject/link_loss?stationId=bharati")
    fault = ("POST", "/inject/co2_spike", {"station": "bharati", "duration": 120, "source": "public-demo"})
    assert fault in ub.sim_calls
    assert client.get("/api/sim/scenarios?stationId=bharati").json()["activeScenario"] == "link_loss"
    client.post("/api/sim/reset?stationId=bharati")
    assert ("POST", "/reset", {"station": "bharati", "source": "public-demo"}) in ub.sim_calls
