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
