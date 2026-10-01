"""station_config.json is the single source of truth for station facts (A)."""

import json

import pytest
from fastapi.testclient import TestClient

import station_config as sc


def test_config_loads_and_covers_both_stations():
    assert sc.station_ids() == ("maitri", "bharati")
    for sid in sc.station_ids():
        assert len(sc.buildings(sid)) == 8
        assert sc.dependency_graph(sid)["generator"]["dependents"]


def test_resolved_inconsistencies_are_recorded_with_provenance():
    maitri = sc.station("maitri")["metadata"]
    bharati = sc.station("bharati")["metadata"]
    assert maitri["elevation_m"]["value"] == 117 and maitri["elevation_m"]["needsNcporConfirmation"]
    assert bharati["elevation_m"]["value"] == 35 and bharati["elevation_m"]["needsNcporConfirmation"]
    assert bharati["personnelWinter"]["confidence"] == "low"
    for sid in sc.station_ids():
        for key, m in sc.station(sid)["metadata"].items():
            if isinstance(m, dict) and "value" in m:
                assert m["source"] and m["confidence"] in {"high", "medium", "low"}, (sid, key)


def test_every_physics_sensor_has_default_thresholds():
    from physics_model import StationPhysicsModel
    for sid in sc.station_ids():
        readings = StationPhysicsModel(sid).compute(
            {"env_temp": -20, "env_wind": 20, "env_pressure": 980, "env_humidity": 60}, dt_seconds=2)
        readings.pop("_meta")
        emitted = {s for sensors in readings.values() for s in sensors}
        th = sc.default_thresholds(sid)
        assert emitted <= set(th), emitted - set(th)
        for name, t in th.items():
            assert t, name
            for levels in t.values():
                assert set(levels) == {"warning", "critical"}


def test_consumers_read_the_config():
    import decision_engine
    import forecast_engine
    import ncpor_ingestor
    import physics_model
    import weather_data
    for sid in sc.station_ids():
        c = sc.coords(sid)
        assert ncpor_ingestor.STATION_INFO[sid]["latitude"] == c["lat"]
        assert ncpor_ingestor.STATION_INFO[sid]["elevation_m"] == c["alt_m"]
        assert weather_data.STATION_COORDS[sid] == c
        assert forecast_engine.STATION_COORDS[sid] == c
        assert physics_model.STATION_PHYSICS[sid]["name"] == sc.meta_value(sid, "name")
        assert physics_model.STATION_PHYSICS[sid]["established"] == sc.meta_value(sid, "commissionedYear")
    assert decision_engine.DEPENDENCY_GRAPH == sc.decision_causal_graph()


def test_cascade_uses_config_graph():
    from cascade import analyze_dependency_cascade
    out = analyze_dependency_cascade({"heatingB": "critical"}, "bharati")
    assert {c["affectedBuilding"] for c in out} == {"lab"}          # heatingB heats the lab
    out = analyze_dependency_cascade({"storage": "warning"}, "maitri")
    pairs = {(c["sourceBuilding"], c["affectedBuilding"]) for c in out}
    assert ("storage", "generator") in pairs and ("storage", "heating") in pairs   # second order


def test_invalid_config_is_rejected(tmp_path, monkeypatch):
    cfg = json.loads(json.dumps(sc.load()))
    cfg["stations"]["maitri"]["dependencyGraph"]["edges"].append(
        {"source": "generator", "target": "nope", "relation": "x"})
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(cfg))
    import config as app_config
    monkeypatch.setattr(app_config, "STATION_CONFIG_PATH", bad)
    sc.load.cache_clear()
    try:
        with pytest.raises(sc.StationConfigError):
            sc.load()
    finally:
        sc.load.cache_clear()


def test_config_endpoints(temp_db):
    import unified_backend as ub
    with TestClient(ub.app) as c:
        full = c.get("/api/config/stations").json()
        assert full == sc.load()
        stations = {s["id"]: s for s in c.get("/api/stations").json()}
        assert stations["maitri"]["elevation_m"] == 117 and stations["bharati"]["elevation_m"] == 35
        assert stations["bharati"]["personnelWinter"] == sc.meta_value("bharati", "personnelWinter")
