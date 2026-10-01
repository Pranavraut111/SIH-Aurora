"""Chronos integration tests.

Converted from the old `simulator/test_chronos.py` print-script. Everything that only
exercises the buffering/plumbing runs in the default suite; the tests that actually load
`amazon/chronos-bolt-small` and run inference are marked `ml` and are deselected unless
you ask for them (`pytest -m ml`) with torch + chronos-forecasting installed.

Buffer-input edge cases (fuel from readings, per-station inference guard, honest
availability) live in `test_chronos_inputs.py`.
"""

import math
import time

import pytest

import chronos_forecaster as cf
from chronos_forecaster import (
    FORECAST_SIGNALS,
    MIN_CONTEXT_LENGTH,
    MODEL_NAME,
    PREDICTION_LENGTH,
    GenuineChronosForecaster,
    HistoryBuffer,
    _check_chronos_available,
)

requires_chronos = pytest.mark.skipif(
    not _check_chronos_available(),
    reason="torch + chronos-forecasting not installed (pip install -r simulator/requirements-ml.txt)",
)


def _force_downsample(forecaster, station):
    """Downsampling is time-based; reset the window so every append lands in the buffer."""
    buf = forecaster.get_buffer(station)
    for sig in FORECAST_SIGNALS:
        buf._last_ds_time[sig] = 0
    return buf


def _fill(forecaster, station, n, temp0, temp_step, load0, load_step, fuel0, fuel_step):
    for i in range(n):
        _force_downsample(forecaster, station)
        forecaster.append_telemetry(
            station,
            {"generator": {"gen_temp": temp0 + i * temp_step}},
            meta={"gen_load_pct": load0 + i * load_step, "fuel_rate_Lhr": fuel0 + i * fuel_step},
        )
    return forecaster.get_buffer(station)


# ── Module contract ─────────────────────────────────────────────────────────
def test_forecast_signals_are_the_three_generator_signals():
    assert FORECAST_SIGNALS == ["gen_temp_C", "gen_load_pct", "fuel_rate_Lhr"]


def test_model_name_is_chronos_bolt_small():
    assert MODEL_NAME == "amazon/chronos-bolt-small"


def test_minimum_context_is_at_least_30_points():
    assert MIN_CONTEXT_LENGTH >= 30


def test_availability_check_returns_a_bool():
    assert isinstance(_check_chronos_available(), bool)


# ── Station isolation ───────────────────────────────────────────────────────
@pytest.fixture
def two_stations():
    f = GenuineChronosForecaster()
    _fill(f, "maitri", 50, 60, 0.5, 40, 0.3, 15, 0.1)
    _fill(f, "bharati", 50, 45, 0.3, 30, 0.2, 12, 0.08)
    return f


def test_each_station_gets_its_own_buffer(two_stations):
    assert two_stations.get_buffer("maitri") is not two_stations.get_buffer("bharati")


@pytest.mark.parametrize("station", ["maitri", "bharati"])
def test_both_stations_reach_forecastable_context(two_stations, station):
    buf = two_stations.get_buffer(station)
    assert buf.context_length("gen_temp_C") >= MIN_CONTEXT_LENGTH
    assert buf.ready("gen_temp_C")


def test_station_histories_do_not_mix(two_stations):
    maitri = list(two_stations.get_buffer("maitri")._downsampled["gen_temp_C"])
    bharati = list(two_stations.get_buffer("bharati")._downsampled["gen_temp_C"])
    assert maitri and bharati
    assert abs(maitri[0] - bharati[0]) > 1, f"maitri[0]={maitri[0]}, bharati[0]={bharati[0]}"


# ── Insufficient history is reported honestly, never faked ──────────────────
@pytest.fixture
def barely_filled():
    f = GenuineChronosForecaster()
    _fill(f, "test_station", 1, 55.0, 0, 40, 0, 15, 0)
    return f


def test_one_sample_is_not_ready(barely_filled):
    assert not barely_filled.get_buffer("test_station").ready("gen_temp_C")


def test_cached_forecast_says_unavailable_with_a_reason(barely_filled):
    cached = barely_filled.get_cached_forecast("test_station")
    assert cached["available"] is False
    assert cached.get("reason")
    assert "bufferStatus" in cached


# ── Downsampling ────────────────────────────────────────────────────────────
def test_downsampling_collapses_ticks_into_windows():
    buf = HistoryBuffer("ds_test", downsample_seconds=10)
    base_time = 1000.0
    for i in range(30):
        buf.append("gen_temp_C", 60 + i * 0.1, base_time + i)
        if (i + 1) % 10 == 0:
            buf._last_ds_time["gen_temp_C"] = base_time + i - 10
    length = buf.context_length("gen_temp_C")
    assert 0 < length < 30, f"30 raw ticks downsampled to {length}"


# ── Readings arrive both as {"value": x} and as bare numbers ────────────────
def test_both_dict_and_scalar_readings_are_accepted():
    f = GenuineChronosForecaster()
    _force_downsample(f, "fmt_test")
    f.append_telemetry(
        "fmt_test",
        {"generator": {"gen_temp": {"value": 65.0, "unit": "°C"}}},
        meta={"gen_load_pct": 42, "fuel_rate_Lhr": 16},
    )
    buf = f.get_buffer("fmt_test")
    assert buf.context_length("gen_temp_C") == 1
    assert list(buf._downsampled["gen_temp_C"])[-1] == pytest.approx(65.0)

    _force_downsample(f, "fmt_test")
    f.append_telemetry(
        "fmt_test",
        {"generator": {"gen_temp": 66.0}},
        meta={"gen_load_pct": 43, "fuel_rate_Lhr": 16.5},
    )
    assert buf.context_length("gen_temp_C") == 2
    # The window average spans both readings, because _force_downsample reopened the window.
    assert list(buf._downsampled["gen_temp_C"])[-1] == pytest.approx(65.5)


# ── Status ──────────────────────────────────────────────────────────────────
def test_status_reports_availability_model_and_per_station_buffers(two_stations):
    status = two_stations.status()
    assert isinstance(status["chronos_available"], bool)
    assert status["model"] == MODEL_NAME
    assert status["chronos_available"] == cf.chronos_available()
    assert "inference_running" in status
    assert set(status["stations"]) == {"maitri", "bharati"}


# ── Genuine inference (needs torch + chronos-forecasting) ───────────────────
@pytest.fixture(scope="module")
def inference_result():
    """One real forecast, shared by the `ml` tests below — loading the model is slow."""
    if not _check_chronos_available():
        pytest.skip("chronos not installed")
    f = GenuineChronosForecaster()
    for i in range(MIN_CONTEXT_LENGTH + 20):
        _force_downsample(f, "maitri")
        f.append_telemetry(
            "maitri",
            {"generator": {"gen_temp": 60 + 5 * math.sin(i * 0.1) + i * 0.05}},
            meta={
                "gen_load_pct": 40 + 3 * math.sin(i * 0.08),
                "fuel_rate_Lhr": 15 + math.sin(i * 0.12),
            },
        )
    started = time.monotonic()
    result = f.run_forecast("maitri")
    return result, time.monotonic() - started, f


@pytest.mark.ml
@requires_chronos
def test_inference_produces_a_forecast(inference_result):
    result, _, _ = inference_result
    assert result["available"] is True, result.get("reason", "unknown")
    assert result["stationId"] == "maitri"


@pytest.mark.ml
@requires_chronos
def test_inference_finishes_in_under_30_seconds(inference_result):
    _, elapsed, _ = inference_result
    assert elapsed < 30, f"took {elapsed:.1f}s"


@pytest.mark.ml
@requires_chronos
def test_inference_provenance_is_honest(inference_result):
    result, _, _ = inference_result
    provenance = result["provenance"]
    assert provenance["model"] == MODEL_NAME
    assert "zero-shot" in provenance["method"]


@pytest.mark.ml
@requires_chronos
@pytest.mark.parametrize("signal", FORECAST_SIGNALS)
def test_each_signal_has_a_full_quantile_band(inference_result, signal):
    result, _, _ = inference_result
    fc = result["forecasts"][signal]
    assert fc["available"] is True, fc.get("reason", "unknown")
    for key in ("p10", "median", "p90"):
        assert len(fc[key]) == PREDICTION_LENGTH, f"{signal}.{key} has {len(fc[key])} values"
    assert fc["p10"][0] <= fc["median"][0] <= fc["p90"][0], (
        f"{signal}: p10={fc['p10'][0]}, median={fc['median'][0]}, p90={fc['p90'][0]}"
    )


@pytest.mark.ml
@requires_chronos
def test_the_forecast_is_cached_with_its_age(inference_result):
    _, _, forecaster = inference_result
    cached = forecaster.get_cached_forecast("maitri")
    assert cached["available"] is True
    assert cached["cacheAge_seconds"] >= 0
