"""Units: store_* (kL / days / items) and comms bandwidth (Mbps) are consistent across
physics_model.py, simulator.py and unified_backend.py; backend wind is m/s → km/h once."""

import ast

import pytest

from conftest import insert_obs, SIM_DIR

STORE_UNITS = {"store_fuel": "kL", "store_food": "days", "store_spares": "items"}


def test_physics_model_units():
    from physics_model import StationPhysicsModel
    r = StationPhysicsModel("maitri").compute({"env_temp": -20, "env_wind": 30, "env_pressure": 980,
                                               "env_humidity": 60}, dt_seconds=2)
    assert {k: r["storage"][k]["unit"] for k in STORE_UNITS} == STORE_UNITS
    assert r["commsMast"]["comms_bandwidth"]["unit"] == "Mbps"


def test_simulator_profiles_units():
    """Parse simulator.py (importing it would start both stations)."""
    tree = ast.parse((SIM_DIR / "simulator.py").read_text())
    profiles = next(
        ast.literal_eval(node.value) for node in ast.walk(tree)
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "STATION_PROFILES" for t in node.targets)
    )
    for station, prof in profiles.items():
        sensors = prof["sensors"]
        assert {k: sensors["storage"][k]["unit"] for k in STORE_UNITS} == STORE_UNITS, station
        assert sensors["commsMast"]["comms_bandwidth"]["unit"] == "Mbps", station


def test_backend_fallback_storage_is_model_derived_kl(temp_db):
    import unified_backend as ub
    fb = ub.advance_fallback("maitri")
    pm = ub.PHYSICS["maitri"]
    storage = fb["sensors"]["storage"]
    assert storage["store_fuel"] == pytest.approx(pm.fuel_kL, abs=0.01)       # kL, not litres
    assert storage["store_food"] == pytest.approx(pm.food_days, abs=0.1)
    assert storage["store_spares"] == pytest.approx(pm.spares, abs=0.5)
    assert storage["store_fuel"] < 1000                                          # old bug: 68400 (litres)
    snap = ub.snapshot_from_fallback("maitri", fb, None)
    assert snap["provenance"]["storage"] == "MODEL-DERIVED"


def test_backend_wind_ms_to_kmh_exactly_once(temp_db):
    import unified_backend as ub
    ts = 1_900_000_000_000
    insert_obs(temp_db, [
        ("bharati", ts, "wind_speed", 10.0, "m/s", "Open-Meteo ERA5 reanalysis", "Antarctic-ERA5-Reanalysis"),
        ("bharati", ts, "temperature", -12.0, "°C", "Open-Meteo ERA5 reanalysis", "Antarctic-ERA5-Reanalysis"),
    ])
    fb = ub.advance_fallback("bharati")
    assert fb["sensors"]["lab"]["env_wind"] == pytest.approx(36.0)             # 10 m/s → 36 km/h, not 129.6
    snap = ub.snapshot_from_fallback("bharati", fb, None)
    assert snap["provenance"]["environment"] == "REANALYSIS"


def test_ui_labels_match_convention():
    src = (SIM_DIR.parent / "src" / "data" / "stationData.js").read_text()
    assert "id: 'comms_bandwidth', name: 'Bandwidth', unit: 'Mbps'" in src
    for key, unit in STORE_UNITS.items():
        assert f"id: '{key}'" in src and f"unit: '{unit}'" in src
