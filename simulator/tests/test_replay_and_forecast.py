"""B19 replay loop; forecast_engine refresh / offline fallback / units / replay alignment."""

import json
import logging
import time
from datetime import datetime, timedelta, timezone

import pytest
from conftest import write_cache

# ── B19: replay loops instead of freezing ─────────────────────

@pytest.fixture
def layer(tmp_path, monkeypatch):
    import weather_data
    monkeypatch.setattr(weather_data, "CACHE_DIR", tmp_path)
    times = [f"2024-01-01T0{h}:00" for h in range(5)]          # 5 points → 4 h span
    write_cache(tmp_path / "maitri_2024-01-01_2024-01-08.json", times, [36.0] * 5,
                temps=[0.0, -1.0, -2.0, -3.0, -4.0])
    lyr = weather_data.WeatherDataLayer("maitri", date="2024-01-01", speed_factor=3600)  # 1 s real = 1 h sim
    assert lyr.fetch_and_cache()
    lyr.start_time = 1_000_000.0
    return weather_data, lyr


def test_replay_loops_back_to_start(layer, monkeypatch, caplog):
    weather_data, lyr = layer
    caplog.set_level(logging.INFO, logger="aurora.weather")
    monkeypatch.setattr(weather_data.time, "time", lambda: 1_000_000.0 + 3.5)   # 3.5 h
    w = lyr.get_current_weather()
    assert w["replay_loop"] == 0 and w["env_temp"] == pytest.approx(-3.5)
    assert "looping" not in caplog.text

    monkeypatch.setattr(weather_data.time, "time", lambda: 1_000_000.0 + 5.5)   # 5.5 h → 1.5 h into loop 1
    w = lyr.get_current_weather()
    assert w["replay_loop"] == 1
    assert w["env_temp"] == pytest.approx(-1.5)                                 # NOT frozen at -4.0
    assert w["simulated_time"].startswith("2024-01-01T01:30")
    assert "looping to start" in caplog.text

    caplog.clear()
    lyr.get_current_weather()                                                    # same loop → no repeat log
    assert "looping" not in caplog.text
    assert lyr.get_replay_progress()["replay_loop"] == 1


def test_interpolation_keeps_zero_values(layer, monkeypatch):
    """`lo or hi` used to return hi when lo == 0.0."""
    weather_data, lyr = layer
    lyr.data["temperature_2m"][1] = None
    monkeypatch.setattr(weather_data.time, "time", lambda: 1_000_000.0 + 0.5)
    assert lyr.get_current_weather()["env_temp"] == pytest.approx(0.0)


# ── forecast_engine ───────────────────────────────────────────

def _forecast_cache(path, fetch_time, wind_unit=None, wind=36.0, temps=None, hours=30):
    # naive UTC, matching the "%Y-%m-%dT%H:%M" GMT strings Open-Meteo returns
    now = datetime.now(timezone.utc).replace(tzinfo=None, minute=0, second=0, microsecond=0)
    times = [(now + timedelta(hours=h - 1)).strftime("%Y-%m-%dT%H:%M") for h in range(hours)]
    data = {"fetch_time": fetch_time, "hourly": {
        "time": times,
        "temperature_2m": temps or [-10.0] * hours,
        "wind_speed_10m": [wind] * hours,
        "surface_pressure": [980.0] * hours,
        "relative_humidity_2m": [60.0] * hours,
    }}
    if wind_unit:
        data["hourly_units"] = {"wind_speed_10m": wind_unit}
    path.write_text(json.dumps(data))


@pytest.fixture
def fe(tmp_path, monkeypatch):
    import forecast_engine
    monkeypatch.setattr(forecast_engine, "forecast_cache_path", lambda sid: tmp_path / f"{sid}_forecast.json")
    return forecast_engine, tmp_path


def test_offline_uses_stale_cache_and_logs_once(fe, caplog):
    forecast_engine, tmp = fe
    caplog.set_level(logging.WARNING, logger="aurora.forecast")
    _forecast_cache(tmp / "maitri_forecast.json", fetch_time=time.time() - 5 * 3600)  # stale (>3 h)
    wf = forecast_engine.WeatherForecast("maitri")
    assert wf.fetch() is True                        # network blocked → cached forecast used
    assert caplog.text.count("using cached forecast") == 1
    wf._next_retry = 0                               # backoff elapsed, still offline
    assert wf.refresh_if_stale() is True
    assert caplog.text.count("Forecast refresh failed") == 1   # logged once per outage, not per tick


def test_offline_without_cache_is_unavailable(fe):
    forecast_engine, _ = fe
    assert forecast_engine.WeatherForecast("maitri").fetch() is False


def test_fresh_cache_does_not_hit_network(fe, monkeypatch):
    forecast_engine, tmp = fe
    _forecast_cache(tmp / "maitri_forecast.json", fetch_time=time.time() - 60)
    calls = {"n": 0}
    monkeypatch.setattr(forecast_engine.WeatherForecast, "_download",
                        lambda self: calls.__setitem__("n", calls["n"] + 1) or False)
    assert forecast_engine.WeatherForecast("maitri").fetch() is True
    assert calls["n"] == 0


def test_refresh_interval_is_three_hours(fe):
    forecast_engine, _ = fe
    assert forecast_engine.FORECAST_REFRESH_S == 3 * 3600


@pytest.mark.parametrize("unit,raw", [(None, 36.0), ("km/h", 36.0), ("m/s", 10.0)])
def test_forecast_wind_is_kmh(fe, unit, raw):
    forecast_engine, tmp = fe
    _forecast_cache(tmp / "maitri_forecast.json", fetch_time=time.time(), wind_unit=unit, wind=raw)
    wf = forecast_engine.WeatherForecast("maitri")
    assert wf.fetch()
    assert wf.get_at_hour(1)["env_wind"] == pytest.approx(36.0)


def _predict(forecast_engine, replay_mode, current_temp):
    from physics_model import StationPhysicsModel
    eng = forecast_engine.ForecastEngine("maitri", replay_mode=replay_mode)
    assert eng.initialize()
    return eng.predict(StationPhysicsModel("maitri"), {"env_temp": current_temp, "env_wind": 20.0})


def test_replay_mode_labels_alignment_and_skips_cross_timebase_delta(fe):
    forecast_engine, tmp = fe
    _forecast_cache(tmp / "maitri_forecast.json", fetch_time=time.time())   # live forecast: flat -10 °C
    replay = _predict(forecast_engine, replay_mode=True, current_temp=-40.0)    # replayed past weather
    assert replay["timeAligned"] is False
    assert replay["provenance"]["alignment"] == "live forecast, not aligned with replay date"
    assert replay["comparisonBaseTemp"] == pytest.approx(-10.0)                # live vs live, not -40
    assert not [f for f in replay["risk"]["factors"] if f["type"].startswith("weather_")]

    live = _predict(forecast_engine, replay_mode=False, current_temp=-40.0)
    assert live["timeAligned"] is True
    assert [f for f in live["risk"]["factors"] if f["type"] == "weather_warming"]   # aligned delta is used


def test_decision_engine_uses_forecast_baseline(fe):
    forecast_engine, tmp = fe
    from decision_engine import DecisionEngine
    _forecast_cache(tmp / "maitri_forecast.json", fetch_time=time.time())
    fc = _predict(forecast_engine, replay_mode=True, current_temp=-40.0)
    decision = DecisionEngine("maitri").evaluate(
        {"weather": {"env_temp": -40.0, "env_wind": 20.0}, "generator": {}, "meta": {}}, None, fc)
    assert decision["forecast"]["temperature_change"] == pytest.approx(0.0)


# ── Replay clock on an absolute (UTC) timeline ───────────────
def test_replay_time_uses_the_stored_utc_offset(tmp_path, monkeypatch):
    import weather_data
    monkeypatch.setattr(weather_data, "CACHE_DIR", tmp_path)
    path = write_cache(tmp_path / "maitri_2024-01-01_2024-01-08.json",
                       [f"2024-01-01T0{h}:00" for h in range(5)], [36.0] * 5)
    data = json.loads(path.read_text())
    data["utc_offset_seconds"] = 7200                       # Open-Meteo timezone=auto, UTC+2
    path.write_text(json.dumps(data))
    lyr = weather_data.WeatherDataLayer("maitri", date="2024-01-01", speed_factor=3600)
    assert lyr.fetch_and_cache()
    w = lyr.sample_at(1.0)                                   # 01:00 local
    assert w["utc_offset_source"] == "open-meteo"
    assert w["simulated_time_ms"] == int(datetime(2023, 12, 31, 23, 0, tzinfo=timezone.utc).timestamp() * 1000)


def test_missing_offset_is_inferred_from_the_radiation_peak():
    import weather_data
    # Local times; radiation (backward hourly means) centred on 14:00 local → local noon 13:30.
    times = [f"2026-09-01T{h:02d}:00" for h in range(24)]
    rad = [max(0.0, 300 - 60 * abs(h - 14)) for h in range(24)]
    # Solar noon at lon 11.73° E is 11:13 UTC → offset ≈ +2 h.
    assert weather_data.infer_utc_offset_hours({"time": times, "shortwave_radiation": rad}, 11.73) == 2
    assert weather_data.infer_utc_offset_hours({"time": times, "shortwave_radiation": [0.0] * 24}, 11.73) is None


def test_offset_unknown_means_no_absolute_replay_time(tmp_path, monkeypatch):
    import weather_data
    monkeypatch.setattr(weather_data, "CACHE_DIR", tmp_path)
    write_cache(tmp_path / "maitri_2024-01-01_2024-01-08.json",
                [f"2024-01-01T0{h}:00" for h in range(5)], [36.0] * 5)     # no radiation, no offset
    lyr = weather_data.WeatherDataLayer("maitri", date="2024-01-01", speed_factor=3600)
    assert lyr.fetch_and_cache()
    w = lyr.sample_at(1.0)
    assert w["simulated_time_ms"] is None and w["utc_offset_source"] == "unknown"
