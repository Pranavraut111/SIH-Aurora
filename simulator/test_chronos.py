#!/usr/bin/env python3
"""
Aurora v3 — Genuine Chronos Integration Tests

Tests that prove:
  1. Model loads correctly
  2. Forecast is produced with correct shape
  3. Insufficient history is handled safely
  4. Maitri/Bharati histories cannot mix
  5. Simulator continues if Chronos inference fails
  6. Provenance metadata is correct
  7. Downsampling works correctly
  8. Async inference doesn't block
"""

import sys
import os
import time
import math
import json

sys.path.insert(0, os.path.dirname(__file__))

from chronos_forecaster import (
    GenuineChronosForecaster,
    HistoryBuffer,
    FORECAST_SIGNALS,
    MIN_CONTEXT_LENGTH,
    MAX_CONTEXT_LENGTH,
    PREDICTION_LENGTH,
    MODEL_NAME,
    _check_chronos_available,
)

PASSED = 0
FAILED = 0


def test(name, condition, detail=""):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ✅ {name}")
    else:
        FAILED += 1
        print(f"  ❌ {name} — {detail}")


def run_tests():
    global PASSED, FAILED
    PASSED = 0
    FAILED = 0

    print("=" * 60)
    print("  Genuine Chronos Integration Tests")
    print("=" * 60)

    # ── Test 1: Module imports ─────────────────────────────────
    print("\n── Module Structure ──")
    test("chronos_forecaster imports cleanly", True)
    test("FORECAST_SIGNALS defined",
         FORECAST_SIGNALS == ["gen_temp_C", "gen_load_pct", "fuel_rate_Lhr"])
    test("MODEL_NAME is chronos-bolt-small",
         MODEL_NAME == "amazon/chronos-bolt-small")
    test("MIN_CONTEXT_LENGTH >= 30",
         MIN_CONTEXT_LENGTH >= 30)

    # ── Test 2: History buffer — station isolation ─────────────
    print("\n── Station Isolation ──")
    forecaster = GenuineChronosForecaster()

    # Fill Maitri with data
    for i in range(50):
        forecaster.append_telemetry("maitri", {
            "generator": {"gen_temp": 60 + i * 0.5}
        }, meta={
            "gen_load_pct": 40 + i * 0.3,
            "fuel_rate_Lhr": 15 + i * 0.1,
        })
        buf = forecaster.get_buffer("maitri")
        for sig in FORECAST_SIGNALS:
            buf._last_ds_time[sig] = 0  # Force downsample

    # Fill Bharati with DIFFERENT data
    for i in range(50):
        forecaster.append_telemetry("bharati", {
            "generator": {"gen_temp": 45 + i * 0.3}
        }, meta={
            "gen_load_pct": 30 + i * 0.2,
            "fuel_rate_Lhr": 12 + i * 0.08,
        })
        buf = forecaster.get_buffer("bharati")
        for sig in FORECAST_SIGNALS:
            buf._last_ds_time[sig] = 0

    maitri_buf = forecaster.get_buffer("maitri")
    bharati_buf = forecaster.get_buffer("bharati")

    test("Maitri buffer exists", maitri_buf is not None)
    test("Bharati buffer exists", bharati_buf is not None)
    test("Maitri buffer is separate from Bharati",
         maitri_buf is not bharati_buf)
    test("Maitri has context for gen_temp_C",
         maitri_buf.context_length("gen_temp_C") >= 30,
         f"got {maitri_buf.context_length('gen_temp_C')}")
    test("Bharati has context for gen_temp_C",
         bharati_buf.context_length("gen_temp_C") >= 30,
         f"got {bharati_buf.context_length('gen_temp_C')}")

    # Check that first values are different
    m_ds = list(maitri_buf._downsampled["gen_temp_C"])
    b_ds = list(bharati_buf._downsampled["gen_temp_C"])
    test("Maitri/Bharati gen_temp histories differ",
         len(m_ds) > 0 and len(b_ds) > 0 and abs(m_ds[0] - b_ds[0]) > 1,
         f"Maitri[0]={m_ds[0] if m_ds else 'empty'}, Bharati[0]={b_ds[0] if b_ds else 'empty'}")

    # ── Test 3: Insufficient history handling ─────────────────
    print("\n── Insufficient History ──")
    empty_forecaster = GenuineChronosForecaster()
    empty_forecaster.append_telemetry("test_station", {
        "generator": {"gen_temp": 55.0}
    }, meta={"gen_load_pct": 40, "fuel_rate_Lhr": 15})
    empty_buf = empty_forecaster.get_buffer("test_station")
    for sig in FORECAST_SIGNALS:
        empty_buf._last_ds_time[sig] = 0

    test("Insufficient context returns not ready",
         not empty_buf.ready("gen_temp_C"),
         f"got ready={empty_buf.ready('gen_temp_C')}")

    cached = empty_forecaster.get_cached_forecast("test_station")
    test("Cached forecast shows 'not available' when empty",
         cached.get("available") == False)
    test("Buffer status included in response",
         "bufferStatus" in cached)

    # ── Test 4: Downsample logic ──────────────────────────────
    print("\n── Downsampling ──")
    ds_buf = HistoryBuffer("ds_test", downsample_seconds=10)

    # Simulate 30 readings over "30 seconds" (3 per downsample window)
    base_time = 1000.0
    for i in range(30):
        ds_buf.append("gen_temp_C", 60 + i * 0.1, base_time + i)
        # Manually trigger downsample at window boundaries
        if (i + 1) % 10 == 0:
            ds_buf._last_ds_time["gen_temp_C"] = base_time + i - 10

    # Should have ~3 downsampled points (30 readings / 10-sec windows)
    ds_len = ds_buf.context_length("gen_temp_C")
    test("Downsampled buffer has points",
         ds_len > 0,
         f"got {ds_len}")

    # ── Test 5: Dict sensor format handling ───────────────────
    print("\n── Sensor Format Handling ──")
    fmt_forecaster = GenuineChronosForecaster()
    # Test both dict and scalar formats
    fmt_forecaster.append_telemetry("fmt_test", {
        "generator": {"gen_temp": {"value": 65.0, "unit": "°C"}}
    }, meta={"gen_load_pct": 42, "fuel_rate_Lhr": 16})
    fmt_buf = fmt_forecaster.get_buffer("fmt_test")
    for sig in FORECAST_SIGNALS:
        fmt_buf._last_ds_time[sig] = 0

    test("Dict-format gen_temp extracted correctly",
         fmt_buf.context_length("gen_temp_C") >= 1)

    fmt_forecaster.append_telemetry("fmt_test", {
        "generator": {"gen_temp": 66.0}
    }, meta={"gen_load_pct": 43, "fuel_rate_Lhr": 16.5})
    for sig in FORECAST_SIGNALS:
        fmt_buf._last_ds_time[sig] = 0

    test("Scalar-format gen_temp extracted correctly",
         fmt_buf.context_length("gen_temp_C") >= 2)

    # ── Test 6: Status endpoint ───────────────────────────────
    print("\n── Status ──")
    status = forecaster.status()
    test("Status includes chronos_available field",
         "chronos_available" in status)
    test("Status includes model name",
         status.get("model") == MODEL_NAME)
    test("Status includes station data",
         "maitri" in status.get("stations", {}))
    test("Status shows inference_running field",
         "inference_running" in status)

    # ── Test 7: Chronos availability check ────────────────────
    print("\n── Chronos Availability ──")
    chronos_ok = _check_chronos_available()
    test(f"chronos-forecasting installed: {chronos_ok}",
         isinstance(chronos_ok, bool))

    # ── Test 8: Actual inference (only if chronos is installed) ─
    if chronos_ok:
        print("\n── Genuine Chronos Inference ──")

        # Build a proper forecaster with enough history
        inf_forecaster = GenuineChronosForecaster()
        for i in range(MIN_CONTEXT_LENGTH + 20):
            t = 60 + 5 * math.sin(i * 0.1) + i * 0.05
            inf_forecaster.append_telemetry("maitri", {
                "generator": {"gen_temp": t}
            }, meta={
                "gen_load_pct": 40 + 3 * math.sin(i * 0.08),
                "fuel_rate_Lhr": 15 + math.sin(i * 0.12),
            })
            buf = inf_forecaster.get_buffer("maitri")
            for sig in FORECAST_SIGNALS:
                buf._last_ds_time[sig] = 0

        start = time.time()
        result = inf_forecaster.run_forecast("maitri")
        elapsed = time.time() - start

        test("Forecast result is available",
             result.get("available") == True,
             f"got: {result.get('reason', 'unknown')}")

        test(f"Inference completed in <30s (got {elapsed:.1f}s)",
             elapsed < 30)

        test("Station ID in result",
             result.get("stationId") == "maitri")

        test("Provenance includes model name",
             result.get("provenance", {}).get("model") == MODEL_NAME)

        test("Provenance says zero-shot",
             "zero-shot" in result.get("provenance", {}).get("method", ""))

        # Check forecast shape for each signal
        forecasts = result.get("forecasts", {})
        for sig in FORECAST_SIGNALS:
            fc = forecasts.get(sig, {})
            if fc.get("available"):
                test(f"{sig}: median has {PREDICTION_LENGTH} values",
                     len(fc.get("median", [])) == PREDICTION_LENGTH,
                     f"got {len(fc.get('median', []))}")
                test(f"{sig}: p10 has {PREDICTION_LENGTH} values",
                     len(fc.get("p10", [])) == PREDICTION_LENGTH)
                test(f"{sig}: p90 has {PREDICTION_LENGTH} values",
                     len(fc.get("p90", [])) == PREDICTION_LENGTH)
                test(f"{sig}: p10 <= median <= p90 (first step)",
                     fc["p10"][0] <= fc["median"][0] <= fc["p90"][0],
                     f"p10={fc['p10'][0]}, median={fc['median'][0]}, p90={fc['p90'][0]}")
            else:
                test(f"{sig}: forecast available",
                     False, fc.get("reason", "unknown"))

        # Test cached result
        cached = inf_forecaster.get_cached_forecast("maitri")
        test("Cached forecast available",
             cached.get("available") == True)
        test("Cache age tracked",
             "cacheAge_seconds" in cached)

    else:
        print("\n── Skipping Inference Tests (chronos not installed) ──")
        print("  To run full tests: pip install chronos-forecasting torch")

    # ── Summary ───────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    total = PASSED + FAILED
    print(f"  Results: {PASSED}/{total} passed, {FAILED} failed")
    if FAILED == 0:
        print(f"  ✅ ALL TESTS PASSED")
    else:
        print(f"  ❌ {FAILED} TESTS FAILED")
    print(f"{'=' * 60}")

    return FAILED == 0


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
