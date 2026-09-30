"""B9/B10/B11 — Chronos fuel input, per-station inference guard, honest availability.
(These tests do not need torch/chronos installed.)"""

import importlib.util
import threading

import chronos_forecaster as cf


def _force_downsample(forecaster, station):
    buf = forecaster.get_buffer(station)
    for sig in cf.FORECAST_SIGNALS:
        buf._last_ds_time[sig] = 0


def test_fuel_rate_comes_from_generator_readings():
    """B9: physics `_meta` has no fuel_rate_Lhr, so fuel must come from readings."""
    f = cf.GenuineChronosForecaster()
    meta_without_fuel = {"gen_load_pct": 41.0}          # like the real physics _meta
    for i in range(3):
        _force_downsample(f, "maitri")
        f.append_telemetry("maitri", {"generator": {"gen_temp": 60.0 + i, "gen_fuel_rate": 15.0 + i}},
                           meta_without_fuel)
    buf = f.get_buffer("maitri")
    assert buf.context_length("fuel_rate_Lhr") == 3
    assert buf.context_length("gen_temp_C") == 3
    assert buf.context_length("gen_load_pct") == 3


def test_fuel_rate_accepts_dict_readings():
    f = cf.GenuineChronosForecaster()
    _force_downsample(f, "bharati")
    f.append_telemetry("bharati", {"generator": {"gen_fuel_rate": {"value": 14.2, "unit": "L/hr"}}}, None)
    assert f.get_buffer("bharati").context_length("fuel_rate_Lhr") == 1


def test_station_buffers_are_isolated():
    f = cf.GenuineChronosForecaster()
    _force_downsample(f, "maitri")
    f.append_telemetry("maitri", {"generator": {"gen_fuel_rate": 15.0}}, None)
    assert f.get_buffer("bharati").context_length("fuel_rate_Lhr") == 0


def test_per_station_guard_acquired_before_thread_start(monkeypatch):
    """B10: the lock is taken synchronously in run_forecast_async (before the
    thread runs), a station can't stack a second run, and stations don't block
    or skip each other."""
    f = cf.GenuineChronosForecaster()
    release = threading.Event()
    started = {"maitri": threading.Event(), "bharati": threading.Event()}

    def slow_forecast(station_id):
        started[station_id].set()
        release.wait(5)
        return {}

    monkeypatch.setattr(f, "run_forecast", slow_forecast)

    assert f.run_forecast_async("maitri") is True
    assert f.inference_running("maitri") is True        # locked BEFORE the thread got scheduled
    assert f.run_forecast_async("maitri") is False      # no stacking on the same station
    assert f.run_forecast_async("bharati") is True      # other station not blocked / skipped
    assert started["maitri"].wait(2) and started["bharati"].wait(2)

    release.set()
    for _ in range(100):
        if not f.inference_running("maitri") and not f.inference_running("bharati"):
            break
        threading.Event().wait(0.02)
    assert not f.inference_running("maitri") and not f.inference_running("bharati")
    assert f.run_forecast_async("maitri") is True        # lock released after completion


def test_lock_released_when_forecast_raises(monkeypatch):
    f = cf.GenuineChronosForecaster()
    done = threading.Event()

    def boom(station_id):
        done.set()
        raise RuntimeError("inference exploded")

    monkeypatch.setattr(f, "run_forecast", boom)
    assert f.run_forecast_async("maitri") is True
    assert done.wait(2)
    for _ in range(100):
        if not f.inference_running("maitri"):
            break
        threading.Event().wait(0.02)
    assert f.inference_running("maitri") is False


def test_chronos_available_is_honest():
    """B11: available only if torch AND chronos actually import."""
    expected = (importlib.util.find_spec("torch") is not None
                and importlib.util.find_spec("chronos") is not None)
    assert cf.chronos_available() is expected
    status = cf.GenuineChronosForecaster().status()
    assert status["chronos_available"] is expected
