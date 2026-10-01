"""
Shared pytest fixtures for the Aurora simulator/backend tests.

Run from the repo root:   pytest simulator/tests
Tests never touch the committed DB, caches or models, and never use the network.
"""

import json
import os
import sys
from pathlib import Path

import pytest

SIM_DIR = Path(__file__).resolve().parents[1]
if str(SIM_DIR) not in sys.path:
    sys.path.insert(0, str(SIM_DIR))
os.environ.setdefault("LOG_LEVEL", "WARNING")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Fail loudly if any test tries to reach the network."""
    import requests

    def _blocked(*args, **kwargs):
        raise requests.exceptions.ConnectionError("network disabled in tests")

    monkeypatch.setattr(requests, "get", _blocked)
    monkeypatch.setattr(requests, "post", _blocked)


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """Fresh SQLite DB created by the real init_db() (schema + seed + migrations),
    with the shared db helper pointed at it."""
    db_path = tmp_path / "obs.db"
    import analytics_ai_engine
    import db
    import ncpor_ingestor
    monkeypatch.setattr(db, "DB_PATH", db_path)     # the one SQLite helper reads DB_PATH at call time
    ncpor_ingestor.init_db()
    analytics_ai_engine.MODEL_CACHE.clear()
    yield db_path
    analytics_ai_engine.MODEL_CACHE.clear()


def insert_obs(db_path, rows):
    """rows: iterable of (station, ts_ms, parameter, value, unit, source, dataset[, sensor, quality])."""
    import db
    with db.connect(db_path) as conn:
        for r in rows:
            station, ts, param, value, unit, source, dataset = r[:7]
            sensor = r[7] if len(r) > 7 else "test"
            quality = r[8] if len(r) > 8 else "test"
            conn.execute(
                """INSERT INTO observations (station_id, station_name, timestamp, iso_time, parameter, value,
                   unit, source, dataset, sensor, quality, latitude, longitude, created_at)
                   VALUES (?, ?, ?, datetime(?/1000, 'unixepoch'), ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)""",
                (station, station.title(), ts, ts, param, value, unit, source, dataset, sensor, quality),
            )


def write_cache(path: Path, times, winds, wind_unit="km/h", temps=None, extra_hourly=None):
    """Write an Open-Meteo style cache file. wind_unit=None → no hourly_units (old format)."""
    hourly = {
        "time": list(times),
        "temperature_2m": list(temps if temps is not None else [-10.0] * len(times)),
        "wind_speed_10m": list(winds),
        "surface_pressure": [980.0] * len(times),
        "relative_humidity_2m": [60.0] * len(times),
        "wind_direction_10m": [90.0] * len(times),
    }
    if extra_hourly:
        hourly.update(extra_hourly)
    data = {"provenance": {"source": "test"}, "hourly": hourly}
    if wind_unit is not None:
        data["hourly_units"] = {"wind_speed_10m": wind_unit, "temperature_2m": "°C"}
    path.write_text(json.dumps(data))
    return path
