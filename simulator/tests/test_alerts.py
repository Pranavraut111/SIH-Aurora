"""Alerts (B): thresholds for every sensor (station_config defaults + SQLite
overrides), persistence in station_alerts, acknowledge (who/when, survives a
restart), hysteresis auto-resolve, history endpoint, and one end-to-end test
per Demo Control scenario through the real simulator injection code."""

import asyncio
import sqlite3

import pytest
from fastapi.testclient import TestClient

import alert_engine
from alert_engine import AlertEngine, classify

SCENARIOS = ["generator_failure", "heating_failure", "blizzard", "water_crisis", "co2_spike"]


@pytest.fixture
def backend(temp_db, monkeypatch):
    """Backend with the background tick disabled: tests drive ticks explicitly."""
    import unified_backend as ub

    async def _no_tick_loop():
        await asyncio.Event().wait()

    monkeypatch.setattr(ub, "tick_loop", _no_tick_loop)
    from station_store import StationStore   # fresh telemetry store: no batches left over from other tests
    monkeypatch.setattr(ub, "store", StationStore(ub.STATIONS, history_max_points=50))
    with TestClient(ub.app) as c:
        yield c, ub


@pytest.fixture(scope="module")
def sim_module():
    import simulator   # builds the default stations (network is blocked in tests)
    return simulator


def _open_alerts(c, sid):
    return c.get(f"/api/alerts?stationId={sid}").json()["activeAlerts"]


# ── pure classification ───────────────────────────────────────

def test_classify_low_high_and_precedence():
    t = {"low": {"warning": 1200, "critical": 900}, "high": {"warning": 1650, "critical": 1800}}
    assert classify(1500, t) == ("normal", None, None)
    assert classify(1100, t) == ("warning", "low", 1200)
    assert classify(850, t) == ("critical", "low", 900)
    assert classify(1700, t) == ("warning", "high", 1650)
    assert classify(1900, t) == ("critical", "high", 1800)


# ── hysteresis (engine level) ─────────────────────────────────

def _sensors(gen_temp):
    return {"generator": {"gen_temp": gen_temp}}


def test_hysteresis_resolve_and_deescalation(temp_db):
    eng = AlertEngine(("maitri", "bharati"), resolve_ticks=3)
    levels, active = eng.evaluate("maitri", _sensors(97), 1)          # critical (>= 95)
    assert levels["generator"] == "critical" and active[0]["sensor"] == "gen_temp"
    alert_id = active[0]["id"]

    eng.evaluate("maitri", _sensors(90), 2)                          # warning level: not yet de-escalated
    eng.evaluate("maitri", _sensors(90), 3)
    assert eng.evaluate("maitri", _sensors(90), 4)[1][0]["level"] == "warning"   # after 3 lower ticks

    for t, v in ((5, 60), (6, 60), (7, 91), (8, 60), (9, 60)):     # flapping does not resolve
        _, active = eng.evaluate("maitri", _sensors(v), t)
    assert active and active[0]["id"] == alert_id
    _, active = eng.evaluate("maitri", _sensors(60), 10)             # 3rd consecutive normal tick
    assert active == []
    row = eng.history("maitri")[0]
    assert row["status"] == "resolved" and row["resolved_at"] == 10 and row["peak_severity"] == "critical"


# ── per-scenario end-to-end: simulator injection → backend alert ──

def _batch(sim, sid):
    return {"stationId": sid, "timestamp": None, "readings": sim.tick(),
            "mode": "reanalysis", "activeScenario": sim.active_scenario,
            "injectedSensors": sorted(sim.active_injections.keys())}


def _step(c, ub, sims):
    for sid, sim in sims.items():
        assert c.post("/api/sensors/batch", json=_batch(sim, sid)).status_code == 200
        ub.tick_station(sid)


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_each_scenario_raises_a_bharati_alert_that_auto_resolves(backend, sim_module, scenario):
    c, ub = backend
    sm = sim_module
    sims = {sid: sm.StationSimulator(sid, mode="reanalysis", date=sm.DEFAULT_DATE, speed_factor=120)
            for sid in ("maitri", "bharati")}
    for _ in range(5):
        _step(c, ub, sims)
    baseline = {sid: {a["sensor"] for a in _open_alerts(c, sid)} for sid in sims}

    injected = {k.split(".")[1] for k in sm.SCENARIOS[scenario]["injections"]}
    sims["bharati"].inject_scenario(scenario)
    raised = None
    for _ in range(8):
        _step(c, ub, sims)
        hits = [a for a in _open_alerts(c, "bharati") if a["sensor"] in injected]
        if hits:
            raised = hits
            break
    assert raised, f"{scenario}: no backend alert on bharati for {injected}"
    assert all(a["sensor"] not in injected or a["sensor"] in baseline["maitri"]
               for a in _open_alerts(c, "maitri")), "maitri must not get the bharati scenario alerts"

    for _ in range(40):                                   # scenario expires, then hysteresis clears it
        _step(c, ub, sims)
        if not sims["bharati"].active_injections and not any(
                a["sensor"] in injected for a in _open_alerts(c, "bharati")):
            break
    assert not any(a["sensor"] in injected for a in _open_alerts(c, "bharati"))
    hist = c.get("/api/alerts/history?stationId=bharati&limit=100").json()["alerts"]
    resolved = [h for h in hist if h["sensor"] in injected and h["status"] == "resolved"]
    assert resolved and all(h["resolvedAt"] for h in resolved)
    maitri_hist = c.get("/api/alerts/history?stationId=maitri&limit=100").json()["alerts"]
    assert not any(h["sensor"] in injected and h["sensor"] not in baseline["maitri"] for h in maitri_hist)


# ── acknowledge (persists across restart) ─────────────────────

def test_acknowledge_records_who_when_and_survives_restart(backend):
    c, ub = backend
    ub.store.record_batch("bharati", {"stationId": "bharati", "readings": {
        "generator": {"gen_temp": {"value": 99.0}}}, "timestamp": None})
    ub.tick_station("bharati")
    alert = next(a for a in _open_alerts(c, "bharati") if a["sensor"] == "gen_temp")
    assert alert["level"] == "critical" and not alert["acknowledged"]

    r = c.post(f"/api/alerts/{alert['id']}/acknowledge", json={"acknowledgedBy": "Duty Engineer"})
    assert r.status_code == 200 and r.json()["acknowledgedBy"] == "Duty Engineer" and r.json()["acknowledgedAt"]
    again = c.post(f"/api/alerts/{alert['id']}/acknowledge", json={"acknowledgedBy": "Someone Else"}).json()
    assert again["alreadyAcknowledged"] and again["acknowledgedBy"] == "Duty Engineer"

    assert c.post("/api/alerts/ALT-nope/acknowledge", json={"acknowledgedBy": "Duty Engineer"}).status_code == 404
    assert c.post(f"/api/alerts/{alert['id']}/acknowledge", json={"acknowledgedBy": "<x>"}).status_code == 422
    assert c.post(f"/api/alerts/{alert['id']}/acknowledge", json={}).status_code == 422

    # "restart": a brand-new engine reloads open alerts from SQLite
    fresh = AlertEngine(ub.STATIONS, resolve_ticks=3)
    assert fresh.load_open() >= 1
    _, active = fresh.evaluate("bharati", {"generator": {"gen_temp": 99.0}}, 10**13)
    reloaded = next(a for a in active if a["id"] == alert["id"])
    assert reloaded["acknowledged"] and reloaded["acknowledgedBy"] == "Duty Engineer"


# ── admin overrides change alert behaviour ────────────────────

def test_admin_threshold_override_changes_alerts(backend):
    c, ub = backend
    cfg = c.get("/api/admin/config?stationId=bharati").json()
    assert cfg["thresholdsUsedByAlerts"] is True
    assert cfg["thresholds"]["gen_temp"]["high"] == {"warning": 88, "critical": 95}
    assert set(cfg["thresholdRules"]) == set(cfg["thresholds"])

    ub.store.record_batch("bharati", {"stationId": "bharati", "readings": {
        "generator": {"gen_temp": {"value": 70.0}}}, "timestamp": None})
    ub.tick_station("bharati")
    assert not any(a["sensor"] == "gen_temp" for a in _open_alerts(c, "bharati"))

    ok = c.post("/api/admin/config", json={"stationId": "bharati", "updatedBy": "Duty Engineer",
                                           "thresholds": {"gen_temp": {"high": {"warning": 65}}}})
    assert ok.status_code == 200, ok.text
    ub.store.record_batch("bharati", {"stationId": "bharati", "readings": {
        "generator": {"gen_temp": {"value": 70.0}}}, "timestamp": None})
    ub.tick_station("bharati")
    a = next(a for a in _open_alerts(c, "bharati") if a["sensor"] == "gen_temp")
    assert a["level"] == "warning" and a["threshold"] == 65
    # station-specific: maitri still uses the default
    assert c.get("/api/admin/config?stationId=maitri").json()["thresholds"]["gen_temp"]["high"]["warning"] == 88
    over = c.get("/api/admin/config?stationId=bharati").json()["thresholdOverrides"]
    assert over[0]["updatedBy"] == "Duty Engineer" and over[0]["value"] == 65

    assert c.post("/api/admin/config/reset", json={"stationId": "bharati", "sensor": "gen_temp",
                                                   "updatedBy": "Duty Engineer"}).json()["removed"] == 1
    assert c.get("/api/admin/config?stationId=bharati").json()["thresholds"]["gen_temp"]["high"]["warning"] == 88


@pytest.mark.parametrize("body,code", [
    ({"thresholds": {"gen_temp": {"high": {"critical": 500}}}}, 422),          # outside range
    ({"thresholds": {"unicorn_level": {"high": {"warning": 1}}}}, 422),        # unknown sensor
    ({"thresholds": {"gen_temp": {"low": {"warning": 50}}}}, 422),             # no low threshold for gen_temp
    ({"thresholds": {"gen_temp": {"high": {"warning": 99}}}}, 422),            # warning >= critical (95)
    ({"thresholds": {"gen_rpm": {"low": {"warning": 800}}}}, 422),             # low warning <= low critical (900)
    ({"thresholds": {"gen_temp": {"high": {"warning": float("nan")}}}}, 422),
    ({"thresholds": {}}, 422),
    ({"stationId": "nowhere"}, 404),
    ({"updatedBy": "?"}, 422),
    ({"thresholds": {"gen_temp": {"high": {"warning": 80}}}, "stationId": "*"}, 200),   # all stations
])
def test_admin_threshold_validation(backend, body, code):
    c, _ = backend
    base = {"stationId": "maitri", "updatedBy": "Duty Engineer", "thresholds": {"gen_temp": {"high": {"warning": 85}}}}
    payload = {**base, **body}
    r = c.post("/api/admin/config", content=__import__("json").dumps(payload, allow_nan=True),
               headers={"Content-Type": "application/json"})
    assert r.status_code == code, r.text


# ── migration 005 from the old admin_thresholds table ─────────

def test_migration_005_moves_operator_values_and_drops_old_table(tmp_path):
    import migrations
    db_path = tmp_path / "old.db"
    conn = sqlite3.connect(str(db_path))   # build a pre-migration DB by hand
    conn.execute("CREATE TABLE station_alerts (id TEXT PRIMARY KEY, station_id TEXT, timestamp INTEGER, severity TEXT, "
                 "subsystem TEXT, parameter TEXT, observed_value REAL, threshold_or_model TEXT, reason TEXT, "
                 "recommended_action TEXT, status TEXT, acknowledged_by TEXT, acknowledged_at INTEGER, resolved_at INTEGER)")
    conn.execute("CREATE TABLE admin_thresholds (key TEXT PRIMARY KEY, value REAL, updated_at INTEGER, updated_by TEXT)")
    conn.executemany("INSERT INTO admin_thresholds VALUES (?, ?, ?, ?)", [
        ("generator_temp_warning", 88.0, 1, "default"),
        ("generator_temp_critical", 96.5, 2, "ops"),
        ("wind_speed_critical_ms", 30.0, 3, "ops"),
        ("fuel_reorder_days", 45.0, 4, "default"),
    ])
    conn.commit()
    res = dict((i, d) for i, _, d in migrations.run_migrations(conn, only={"005_alert_thresholds"}))
    details = res["005_alert_thresholds"]
    rows = conn.execute("SELECT station_id, sensor, direction, level, value, updated_by "
                        "FROM alert_threshold_overrides ORDER BY sensor").fetchall()
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    conn.close()
    assert rows == [("*", "env_wind", "high", "critical", 108.0, "ops"),        # 30 m/s → 108 km/h
                    ("*", "gen_temp", "high", "critical", 96.5, "ops")]       # defaults are not copied
    assert "admin_thresholds" not in tables
    assert details["dropped_unused_settings"] == {"fuel_reorder_days": 45.0}
    assert "threshold_value" in details["station_alerts_columns_added"]


def test_overrides_are_read_by_the_engine(temp_db):
    alert_engine.save_overrides("*", {"lq_co2": {"high": {"warning": 500}}}, "ops")
    assert alert_engine.effective_thresholds("maitri")["lq_co2"]["high"]["warning"] == 500
    alert_engine.save_overrides("maitri", {"lq_co2": {"high": {"warning": 700}}}, "ops")
    assert alert_engine.effective_thresholds("maitri")["lq_co2"]["high"]["warning"] == 700   # station beats '*'
    assert alert_engine.effective_thresholds("bharati")["lq_co2"]["high"]["warning"] == 500
