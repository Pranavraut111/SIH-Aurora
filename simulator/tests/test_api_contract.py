"""REST contract for the unified backend — response *shapes*, not just status codes.

Replaces the old root-level `test_full_suite.py`, which needed a backend running on :8080
and only printed `[PASS]` lines. Everything here runs in-process against `TestClient` with
a throwaway SQLite DB and no network, so it works in CI.

Request-body validation (422s) lives in `test_validation.py`; alert lifecycle in
`test_alerts.py`; the simulator proxies in `test_backend_ai.py`.
"""

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

import station_config

STATIONS = tuple(station_config.station_ids())
WHATIF_SCENARIOS = ("extreme_cold", "blizzard", "gen_failure", "battery_failure",
                    "fuel_leak", "comms_outage", "resupply_delay")
# Every GET that resolves a station must 404 on an unknown one (one shared dependency).
STATION_GETS = (
    "/api/station/{sid}/state",
    "/api/sensors/latest?stationId={sid}",
    "/api/alerts?stationId={sid}",
    "/api/risk?stationId={sid}",
    "/api/logistics?stationId={sid}",
    "/api/twin-inspector?station={sid}",
    "/api/admin/config?stationId={sid}",
    "/api/connection/status?stationId={sid}",
    "/api/history?stationId={sid}&keys=generator.gen_power",
)


@pytest.fixture
def client(temp_db, monkeypatch):
    """Backend on a throwaway DB with a fresh telemetry store and no background tick,
    so one test's ingest can't change what the next one reads."""
    import unified_backend as ub
    from station_store import StationStore

    async def _no_tick_loop():
        await asyncio.Event().wait()

    monkeypatch.setattr(ub, "tick_loop", _no_tick_loop)
    monkeypatch.setattr(ub, "store", StationStore(ub.STATIONS, history_max_points=100))
    with TestClient(ub.app) as c:
        yield c


def _ok(client, path):
    res = client.get(path)
    assert res.status_code == 200, f"GET {path} -> {res.status_code}: {res.text[:200]}"
    return res.json()


# ── Health ──────────────────────────────────────────────────────────────────
def test_health_reports_db_version_and_per_station_telemetry(client):
    body = _ok(client, "/api/health")
    assert body["status"] in ("ok", "degraded")
    assert body["version"]
    assert body["db"]["ok"] is True
    assert body["db"]["error"] is None
    # The simulator is not running under test: the probe must say so, not pretend.
    assert body["simulator"]["reachable"] is False
    assert body["simulator"]["url"]
    assert set(body["stations"]) == set(STATIONS)
    for sid, st in body["stations"].items():
        assert set(st) == {"dataSource", "lastBatchAgeSec", "historyPoints"}, sid
        assert isinstance(st["historyPoints"], int)


# ── Station configuration (the single source of station facts) ───────────────
def test_station_list_exposes_coordinates_from_station_config(client):
    stations = _ok(client, "/api/stations")
    assert [s["id"] for s in stations] == list(STATIONS)
    for s in stations:
        assert {"id", "name", "shortName", "latitude", "longitude", "region"} <= set(s)
        assert -90 <= s["latitude"] <= -60, s          # both stations are Antarctic
        assert isinstance(s["elevation_m"], (int, float))


def test_config_endpoint_serves_the_whole_station_config_file(client):
    body = _ok(client, "/api/config/stations")
    assert body == station_config.load()
    for sid in STATIONS:
        assert {"metadata", "buildings", "sensors"} <= set(body["stations"][sid])


# ── Telemetry snapshots ─────────────────────────────────────────────────────
@pytest.mark.parametrize("sid", STATIONS)
def test_station_state_is_a_published_snapshot_with_provenance(client, sid):
    snap = _ok(client, f"/api/station/{sid}/state")
    assert snap["stationId"] == sid
    assert snap["dataSource"] in ("simulator", "physics-fallback")
    assert "equipment" in snap["provenance"]
    assert snap["sensors"], "no sensor buildings in the snapshot"
    for building in ("generator", "heating", "lab", "commsMast"):
        assert building in snap["sensors"], f"{sid}: missing {building}"
    assert isinstance(snap["activeAlerts"], list)
    assert isinstance(snap["dependencyAlerts"], list)
    # `alerts` is the per-building status roll-up, not a list of alert objects.
    assert set(snap["alerts"]) <= set(snap["sensors"]) | {"overall"}, snap["alerts"]


@pytest.mark.parametrize("sid", STATIONS)
def test_latest_sensors_matches_station_state(client, sid):
    assert _ok(client, f"/api/sensors/latest?stationId={sid}")["stationId"] == sid


def test_sensor_batch_ingest_is_accepted_and_grows_history(client):
    """The simulator's only write path: POST a batch, then read it back."""
    current = _ok(client, "/api/station/bharati/state")
    batch = {
        "stationId": "bharati",
        "timestamp": int(time.time() * 1000),
        "readings": {
            b: {k: {"value": v, "unit": ""} for k, v in sensors.items()}
            for b, sensors in current["sensors"].items()
        },
        "eventTimeline": current.get("eventTimeline", []),
        "activePatterns": current.get("activePatterns", []),
    }
    res = client.post("/api/sensors/batch", json=batch)
    assert res.status_code == 200, res.text
    first = res.json()
    assert first["status"] == "accepted"
    assert first["stationId"] == "bharati"
    assert first["historyPoints"] >= 1
    assert first["receivedAt"] > 0

    second = client.post("/api/sensors/batch", json=batch).json()
    assert second["historyPoints"] > first["historyPoints"]   # one point per sensor, per batch


def test_reads_return_the_last_published_snapshot_not_the_newest_batch(client):
    """Only the background tick republishes; ingest alone must not change what GETs return."""
    import unified_backend as ub

    before = _ok(client, "/api/station/bharati/state")
    assert before["dataSource"] == "physics-fallback"      # no simulator running under test
    current = before["sensors"]
    batch = {
        "stationId": "bharati",
        "timestamp": int(time.time() * 1000),
        "readings": {b: {k: {"value": v, "unit": ""} for k, v in sensors.items()}
                     for b, sensors in current.items()},
    }
    assert client.post("/api/sensors/batch", json=batch).status_code == 200
    assert _ok(client, "/api/station/bharati/state")["dataSource"] == "physics-fallback"

    # A tick selects the fresh batch and republishes it, and only then do reads change.
    ub.tick_station("bharati")
    assert _ok(client, "/api/station/bharati/state")["dataSource"] == "simulator"


# ── Energy figures share the telemetry snapshot (one tick, one timestamp) ────
ENERGY_KEYS = {"totalDemand_kW", "baseElectrical_kW", "heatingElectrical_kW", "ventilation_kW",
               "waterTreatment_kW", "comms_kW", "heatLoss_kW", "heatingDemand_kW", "loadPct"}


def test_fallback_snapshot_carries_the_energy_breakdown_of_the_same_tick(client):
    snap = _ok(client, "/api/station/maitri/state")
    energy = snap["energy"]
    assert set(energy) == ENERGY_KEYS
    # Generation IS the modelled total demand of this tick (the model has no storage).
    assert snap["sensors"]["generator"]["gen_power"] == pytest.approx(energy["totalDemand_kW"], abs=0.05)
    parts = sum(energy[k] for k in ("baseElectrical_kW", "heatingElectrical_kW", "ventilation_kW",
                                     "waterTreatment_kW", "comms_kW"))
    # The remainder is the model's load variation (2 % sigma), never a different tick.
    assert abs(energy["totalDemand_kW"] - parts) <= 0.1 * energy["totalDemand_kW"]


def test_simulator_batch_energy_is_published_with_its_readings(client):
    import unified_backend as ub

    current = _ok(client, "/api/station/bharati/state")
    energy = {k: 1.0 for k in ENERGY_KEYS}
    batch = {
        "stationId": "bharati",
        "timestamp": int(time.time() * 1000),
        "readings": {b: {k: {"value": v, "unit": ""} for k, v in sensors.items()}
                     for b, sensors in current["sensors"].items()},
        "energy": energy,
    }
    assert client.post("/api/sensors/batch", json=batch).status_code == 200
    ub.tick_station("bharati")
    snap = _ok(client, "/api/station/bharati/state")
    assert snap["dataSource"] == "simulator"
    assert snap["timestamp"] == batch["timestamp"]
    assert snap["energy"] == energy

    assert snap["replay"] is None                     # this batch sent no replay clock
    assert _ok(client, "/api/station/maitri/state")["replay"] is None   # fallback: wall clock

    batch["energy"] = {"totalDemand_kW": 1.0, "surprise": 2}
    assert client.post("/api/sensors/batch", json=batch).status_code == 422


# ── Rolling history (charts, 15-min averages) ────────────────────────────────
def test_history_returns_published_points_oldest_first(client):
    import unified_backend as ub

    for _ in range(3):
        ub.tick_station("maitri")
    body = _ok(client, "/api/history?stationId=maitri&keys=generator.gen_power,lab.env_temp&minutes=30")
    assert body["stationId"] == "maitri"
    assert body["tickIntervalSec"] > 0 and body["maxWindowMinutes"] > 0
    power = body["series"]["generator.gen_power"]
    assert len(power) >= 3
    times = [t for t, _ in power]
    assert times == sorted(times) and len(set(times)) == len(times)
    assert power[-1][1] == _ok(client, "/api/station/maitri/state")["sensors"]["generator"]["gen_power"]
    assert len(body["series"]["lab.env_temp"]) >= 3


def test_replay_clock_is_published_and_kept_as_history(client):
    import unified_backend as ub

    current = _ok(client, "/api/station/bharati/state")
    readings = {b: {k: {"value": v, "unit": ""} for k, v in sensors.items()}
                for b, sensors in current["sensors"].items()}
    now = int(time.time() * 1000)
    for i, replay_ms in enumerate((1_756_684_800_000, 1_756_685_040_000)):     # 4 replay-min apart
        batch = {"stationId": "bharati", "timestamp": now + i * 2000, "readings": readings,
                 "replay": {"timeMs": replay_ms, "local": "2025-09-01T05:00:00", "speedFactor": 120,
                            "loop": 0, "utcOffsetSource": "open-meteo"}}
        assert client.post("/api/sensors/batch", json=batch).status_code == 200
        ub.tick_station("bharati")
    snap = _ok(client, "/api/station/bharati/state")
    assert snap["replay"]["timeMs"] == 1_756_685_040_000
    body = _ok(client, "/api/history?stationId=bharati&keys=replay.timeMs,generator.gen_power")
    assert [v for _, v in body["series"]["replay.timeMs"]][-2:] == [1_756_684_800_000, 1_756_685_040_000]
    # every replay point shares its wall-clock timestamp with a reading
    power_ts = {t for t, _ in body["series"]["generator.gen_power"]}
    assert all(t in power_ts for t, _ in body["series"]["replay.timeMs"])
    bad = {"stationId": "bharati", "timestamp": now, "readings": readings, "replay": {"timeMs": 1, "x": 2}}
    assert client.post("/api/sensors/batch", json=bad).status_code == 422


def test_history_unknown_key_is_empty_and_bad_keys_are_422(client):
    body = _ok(client, "/api/history?stationId=maitri&keys=generator.nope")
    assert body["series"] == {"generator.nope": []}
    for bad in ("", "nodot", "a.b;drop", ",".join(f"b.s{i}" for i in range(9))):
        assert client.get(f"/api/history?stationId=maitri&keys={bad}").status_code == 422, bad
    assert client.get("/api/history?stationId=maitri&keys=a.b&minutes=0").status_code == 422
    assert client.get("/api/history?stationId=atlantis&keys=a.b").status_code == 404


def test_republishing_the_same_batch_adds_no_duplicate_history_point():
    from station_store import StationStore

    store = StationStore(["maitri"], history_max_points=5)
    snap = {"timestamp": 1000, "sensors": {"generator": {"gen_power": 70.0, "flag": True}}}
    store.publish("maitri", snap)
    store.publish("maitri", snap)
    assert store.series("maitri", "generator.gen_power") == [(1000, 70.0)]
    assert store.series("maitri", "generator.flag") == []          # non-numeric values skipped
    for ts in range(2000, 9000, 1000):
        store.publish("maitri", {"timestamp": ts, "sensors": {"generator": {"gen_power": 1.0}}})
    assert len(store.series("maitri", "generator.gen_power")) == 5  # bounded window


# ── What-if: rule-based and says so; fuel/resupply effects come from the ledger ──
INVENTED = ("Volvo", "Golovnin", "120 kWh", "SV-04", "Day Tank", "3.8 hours", "180 days", "240 days",
            "NCPOR AWS baseline")


@pytest.mark.parametrize("scenario", WHATIF_SCENARIOS)
def test_whatif_claims_only_what_it_computes(client, scenario):
    body = client.post("/api/simulation/whatif", json={"stationId": "maitri", "scenarioId": scenario}).json()
    text = " ".join(body["consequences"]) + body["provenance"] + body["calculatedRisk"]["recommendedAction"]
    assert not [w for w in INVENTED if w in text], text
    assert body["engine"] == "rule-based" and "not the physics model" in body["provenance"]
    assert body["assumptions"], "assumed coefficients must be listed"


def test_whatif_fuel_leak_autonomy_uses_the_ledger(client):
    snap = _ok(client, "/api/station/maitri/state")
    fuel = next(i for i in _ok(client, "/api/logistics?stationId=maitri")["items"] if i["id"] == "maitri-fuel")
    rate = snap["sensors"]["generator"]["gen_fuel_rate"]
    body = client.post("/api/simulation/whatif",
                       json={"stationId": "maitri", "scenarioId": "fuel_leak", "intensity": 1.0}).json()
    expected = f"{fuel['current'] / (rate * 24):.0f} → {fuel['current'] / ((rate + 16) * 24):.0f} days"
    assert any(expected in c for c in body["consequences"]), body["consequences"]


def test_whatif_resupply_delay_lists_items_that_run_out(client):
    items = _ok(client, "/api/logistics?stationId=maitri")["items"]
    body = client.post("/api/simulation/whatif",
                       json={"stationId": "maitri", "scenarioId": "resupply_delay", "intensity": 2.0}).json()
    short = [i["name"] for i in items if i["daysRemaining"] is not None and i["daysRemaining"] < 120]
    text = " ".join(body["consequences"])
    assert all(name in text for name in short), (short, text)


def test_ncpor_live_reports_when_the_observation_was_taken(client):
    w = _ok(client, "/api/ncpor/live?stationId=maitri")["weather"]
    assert "observedAt" in w
    assert w["observedAt"] is None or w["observedAt"] > 0


# ── Unknown stations 404 everywhere, from one dependency ─────────────────────
@pytest.mark.parametrize("path", STATION_GETS)
def test_unknown_station_is_404_with_a_message(client, path):
    res = client.get(path.format(sid="atlantis"))
    assert res.status_code == 404, f"{path} -> {res.status_code}"
    assert "Unknown station" in res.json()["detail"]


def test_unknown_station_is_404_on_post_routes(client):
    batch = {"stationId": "atlantis", "timestamp": 0, "readings": {}}
    assert client.post("/api/sensors/batch", json=batch).status_code == 404
    assert client.post("/api/connection/toggle?stationId=atlantis").status_code == 404


# ── What-if engine ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("scenario", WHATIF_SCENARIOS)
def test_each_whatif_scenario_returns_a_scored_causal_result(client, scenario):
    res = client.post("/api/simulation/whatif",
                      json={"stationId": "maitri", "scenarioId": scenario, "intensity": 1.2})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["stationId"] == "maitri"
    assert body["scenarioId"] == scenario
    assert body["intensity"] == 1.2
    assert body["dataSource"] in ("simulator", "physics-fallback")
    assert set(body["simulated"]) == {"lab", "generator", "heating", "commsMast"}
    assert set(body["deltas"]) == {"temperature_delta", "wind_delta", "power_delta", "fuel_rate_delta"}
    assert body["affectedSubsystems"], "no affected subsystems reported"
    assert body["consequences"], "no consequences reported"
    risk = body["calculatedRisk"]
    assert 0 <= risk["score"] <= 100
    assert risk["level"] in ("healthy", "warning", "critical")
    assert risk["recommendedAction"]
    assert body["provenance"]


def test_whatif_leaves_the_published_snapshot_untouched(client):
    """The what-if engine is read-only: it must never advance physics state."""
    before = _ok(client, "/api/station/maitri/state")["sensors"]
    client.post("/api/simulation/whatif",
                json={"stationId": "maitri", "scenarioId": "blizzard", "intensity": 2.0})
    assert _ok(client, "/api/station/maitri/state")["sensors"] == before


# ── Satellite link toggle ───────────────────────────────────────────────────
def test_connection_toggle_flips_and_restores(client):
    start = _ok(client, "/api/connection/status?stationId=maitri")["connected"]
    first = client.post("/api/connection/toggle?stationId=maitri").json()
    assert first["status"] == "success"
    assert first["stationId"] == "maitri"
    assert first["connected"] is not start
    assert client.post("/api/connection/toggle?stationId=maitri").json()["connected"] is start


# ── Report data sources ─────────────────────────────────────────────────────
@pytest.mark.parametrize("sid", STATIONS)
def test_risk_assessment_shape(client, sid):
    body = _ok(client, f"/api/risk?stationId={sid}")
    assert isinstance(body["risk_score"], (int, float))
    assert isinstance(body["identified_risks"], list)
    assert "overall_health" in body
    assert "current_weather" in body


@pytest.mark.parametrize("sid", STATIONS)
def test_logistics_is_an_operator_ledger_with_units(client, sid):
    body = _ok(client, f"/api/logistics?stationId={sid}")
    assert body["stationId"] == sid
    assert body["items"], "seeded inventory is empty"
    for item in body["items"]:
        assert {"id", "name", "current", "unit"} <= set(item), item


@pytest.mark.parametrize("sid", STATIONS)
def test_alerts_endpoint_mirrors_the_snapshot(client, sid):
    body = _ok(client, f"/api/alerts?stationId={sid}")
    snap = _ok(client, f"/api/station/{sid}/state")
    assert body["stationId"] == sid
    assert body["dataSource"] == snap["dataSource"]
    assert body["activeAlerts"] == snap["activeAlerts"]
    assert body["alerts"] == snap["alerts"]
    assert body["dependencyAlerts"] == snap["dependencyAlerts"]


@pytest.mark.parametrize("sid", STATIONS)
def test_ncpor_live_reports_wind_in_both_units_from_one_conversion(client, sid):
    """`/api/ncpor/*` is m/s; the km/h figure must come from the single units.py helper.
    (What the route is allowed to claim about its dataset is asserted in test_backend_ai.py.)"""
    weather = _ok(client, f"/api/ncpor/live?stationId={sid}")["weather"]
    assert weather["provenance"] in ("REAL", "REANALYSIS", "MODEL-DERIVED", "SIMULATED", "HARDCODED-DEMO")
    assert weather["wind_speed_kmh"] == pytest.approx(weather["wind_speed_ms"] * 3.6, abs=0.1)


# ── Admin configuration ─────────────────────────────────────────────────────
def test_admin_config_reports_effective_thresholds_and_their_defaults(client):
    body = _ok(client, "/api/admin/config?stationId=maitri")
    assert body["stationId"] == "maitri"
    assert body["system"]["version"]
    assert body["thresholdsUsedByAlerts"] is True
    assert body["usersProvenance"].startswith("HARDCODED-DEMO")
    assert body["thresholds"], "no effective thresholds"
    assert set(body["thresholdDefaults"]) <= set(body["thresholds"])
    for key, rule in body["thresholdRules"].items():
        assert {"name", "building", "unit", "min", "max", "basis"} <= set(rule), key


def test_admin_threshold_override_round_trips(client):
    sensor, default = "gen_temp", _ok(client, "/api/admin/config?stationId=maitri")["thresholdDefaults"]["gen_temp"]
    res = client.post("/api/admin/config",
                      json={"stationId": "maitri",
                            "thresholds": {sensor: {"high": {"critical": 96.5}}},
                            "updatedBy": "contract-test"})
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["status"] == "saved"
    assert saved["valuesSaved"] == 1
    assert saved["thresholds"][sensor]["high"]["critical"] == 96.5

    # Persisted in SQLite, not just echoed back.
    stored = _ok(client, "/api/admin/config?stationId=maitri")
    assert stored["thresholds"][sensor]["high"]["critical"] == 96.5
    assert [(o["sensor"], o["direction"], o["level"], o["value"]) for o in stored["thresholdOverrides"]] == [
        (sensor, "high", "critical", 96.5)
    ]

    reset = client.post("/api/admin/config/reset",
                        json={"stationId": "maitri", "updatedBy": "contract-test"})
    assert reset.status_code == 200, reset.text
    assert reset.json()["removed"] == 1
    after = _ok(client, "/api/admin/config?stationId=maitri")
    assert after["thresholdOverrides"] == []
    assert after["thresholds"][sensor] == default


# ── Liveness probes ─────────────────────────────────────────────────────────
def test_health_answers_head_with_200_and_no_body(client):
    """`curl -I`, load balancers and the nginx container healthcheck all send HEAD.
    FastAPI's @app.get does not register HEAD, so this needs its own route."""
    res = client.head("/api/health")
    assert res.status_code == 200, res.text
    assert res.content == b""


def test_health_get_still_returns_the_full_report(client):
    body = _ok(client, "/api/health")
    assert body["db"]["ok"] is True
    assert "stations" in body
