"""B7 — wind units: ingest from hourly_units, physics replay in km/h, unit helpers."""

import sqlite3

import pytest
from conftest import write_cache

import units

# ── helpers ───────────────────────────────────────────────────

@pytest.mark.parametrize("unit,factor", [("km/h", 1.0), ("m/s", 3.6), ("ms", 3.6), (None, 1.0), ("kn", 1.852)])
def test_wind_factor_to_kmh(unit, factor):
    assert units.wind_factor_to_kmh(unit) == pytest.approx(factor)


def test_missing_unit_means_open_meteo_default_kmh():
    assert units.wind_factor_to_ms(None) == pytest.approx(1 / 3.6)


def test_unknown_unit_raises():
    with pytest.raises(ValueError):
        units.wind_factor_to_kmh("furlongs/fortnight")


def test_ms_kmh_roundtrip():
    assert units.kmh_to_ms(units.ms_to_kmh(10.0)) == pytest.approx(10.0)
    assert units.ms_to_kmh(None) is None


# ── ERA5 cache → SQLite (stored in m/s, honest labels) ─────────

def _ingest(temp_db, tmp_path, monkeypatch, wind_unit, wind_value):
    import ncpor_ingestor
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    write_cache(cache_dir / "maitri_2024-01-01_2024-01-08.json",
                ["2024-01-01T00:00", "2024-01-01T01:00"], [wind_value, wind_value], wind_unit=wind_unit)
    monkeypatch.setattr(ncpor_ingestor, "WEATHER_CACHE_DIR", cache_dir)
    ncpor_ingestor.ingest_cached_historical_data()
    conn = sqlite3.connect(str(temp_db))
    try:
        return conn.execute(
            "SELECT value, unit, source, sensor, quality, dataset FROM observations "
            "WHERE parameter = 'wind_speed'").fetchall()
    finally:
        conn.close()


@pytest.mark.parametrize("wind_unit,raw,expected_ms", [
    ("km/h", 36.0, 10.0),   # explicit km/h → converted
    ("m/s", 10.0, 10.0),    # explicit m/s → unchanged (wind_speed_unit=ms fetches)
    (None, 36.0, 10.0),     # no hourly_units → Open-Meteo default km/h
])
def test_era5_ingest_stores_ms(temp_db, tmp_path, monkeypatch, wind_unit, raw, expected_ms):
    rows = _ingest(temp_db, tmp_path, monkeypatch, wind_unit, raw)
    assert rows, "no wind rows ingested"
    for value, unit, _source, _sensor, _quality, dataset in rows:
        assert value == pytest.approx(expected_ms)
        assert unit == "m/s"
        assert dataset == "Antarctic-ERA5-Reanalysis"


def test_era5_ingest_labels_are_honest(temp_db, tmp_path, monkeypatch):
    _ingest(temp_db, tmp_path, monkeypatch, "km/h", 36.0)
    conn = sqlite3.connect(str(temp_db))
    try:
        labels = conn.execute(
            "SELECT DISTINCT source, sensor, quality FROM observations WHERE dataset = 'Antarctic-ERA5-Reanalysis'"
        ).fetchall()
    finally:
        conn.close()
    assert labels
    for source, sensor, quality in labels:
        text = f"{source} {sensor} {quality}"
        for banned in ("NCPOR", "IMD", "verified_aws_telemetry", "Anemometer", "Hygrometer"):
            assert banned not in text, text
        assert source == "Open-Meteo ERA5 reanalysis"
        assert sensor.startswith("ERA5 ")


# ── Physics replay reads caches in the right unit ─────────────

@pytest.mark.parametrize("wind_unit,raw", [("km/h", 36.0), ("m/s", 10.0), (None, 36.0)])
def test_replay_weather_is_kmh(tmp_path, monkeypatch, wind_unit, raw):
    import weather_data
    monkeypatch.setattr(weather_data, "CACHE_DIR", tmp_path)
    write_cache(tmp_path / "maitri_2024-01-01_2024-01-08.json",
                ["2024-01-01T00:00", "2024-01-01T01:00", "2024-01-01T02:00"], [raw] * 3, wind_unit=wind_unit)
    layer = weather_data.WeatherDataLayer("maitri", date="2024-01-01", speed_factor=1)
    assert layer.fetch_and_cache()
    w = layer.get_current_weather()
    assert w["env_wind"] == pytest.approx(36.0, abs=0.05)   # km/h for the physics model


def test_replay_speed_banner_math():
    import weather_data
    assert weather_data.sim_hours_per_real_minute(120) == pytest.approx(2.0)   # B23
    assert weather_data.sim_hours_per_real_minute(60) == pytest.approx(1.0)
