#!/usr/bin/env python3
"""
Aurora v3 — Genuine Chronos Forecaster

Uses Amazon's pretrained Chronos-Bolt foundation model for
statistical time-series forecasting.

Architecture:
    Historical equipment telemetry (downsampled to 1-min intervals)
            ↓
    Chronos-Bolt-Small (pretrained, zero-shot)
            ↓
    Probabilistic forecast (median + p10/p90 quantiles)
            ↓
    /api/chronos-forecast endpoint

This module is INDEPENDENT of the existing:
    - Physics forecast (forecast_engine.py)
    - Exponential smoothing baseline (legacy/ai-service/ai_service.py)
    - Anomaly detector (anomaly_engine.py)
    - Decision engine (decision_engine.py)

It does NOT make operational decisions.
It provides statistical forecast evidence only.

Provenance:
    model: amazon/chronos-bolt-small
    type: pretrained foundation model (zero-shot)
    note: No Aurora-specific fine-tuning. Statistical patterns only.
"""

import collections
import logging
import time
import threading

log = logging.getLogger("aurora.chronos")

# ── Lazy imports (heavy deps) ─────────────────────────────────
# These are imported lazily so the simulator can start without
# torch/chronos being installed.
_pipeline = None
_torch = None
_CHRONOS_AVAILABLE = None
_pipeline_lock = threading.Lock()    # model is loaded once, even if two stations race
_inference_lock = threading.Lock()   # serialise torch inference (stations queue, never skip)

# Model to use — verified from official repo (Nov 2024 release)
# Chronos-Bolt is 250x faster and 20x more memory efficient than T5
MODEL_NAME = "amazon/chronos-bolt-small"

# Signals we forecast
FORECAST_SIGNALS = ["gen_temp_C", "gen_load_pct", "fuel_rate_Lhr"]

# Configuration
MIN_CONTEXT_LENGTH = 30    # Minimum data points before forecasting
MAX_CONTEXT_LENGTH = 512   # Maximum context window
DOWNSAMPLE_SECONDS = 60    # Downsample 2s ticks → 1-minute samples
PREDICTION_LENGTH = 12     # Forecast 12 steps ahead (= 12 minutes)
DEFAULT_QUANTILES = [0.1, 0.5, 0.9]  # p10, median, p90


def _check_chronos_available():
    """Check if torch and chronos-forecasting are installed."""
    global _CHRONOS_AVAILABLE, _torch
    if _CHRONOS_AVAILABLE is not None:
        return _CHRONOS_AVAILABLE
    try:
        import torch
        _torch = torch
        from chronos import ChronosBoltPipeline  # noqa: F401
        _CHRONOS_AVAILABLE = True
    except ImportError as exc:
        _CHRONOS_AVAILABLE = False
        log.info("Chronos optional ML extras not importable (%s)", exc)
    return _CHRONOS_AVAILABLE


def chronos_available() -> bool:
    """True only if torch AND chronos-forecasting actually import (B11)."""
    return bool(_check_chronos_available())


def _load_pipeline():
    """Load the Chronos-Bolt pipeline (downloads model on first run). Thread-safe."""
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    if not _check_chronos_available():
        return None
    with _pipeline_lock:
        if _pipeline is not None:
            return _pipeline
        return _load_pipeline_locked()


def _load_pipeline_locked():
    global _pipeline
    from chronos import ChronosBoltPipeline
    log.info(f"[Chronos] Loading {MODEL_NAME} ...")
    start = time.time()
    _pipeline = ChronosBoltPipeline.from_pretrained(
        MODEL_NAME,
        device_map="cpu",
    )
    elapsed = time.time() - start
    log.info(f"[Chronos] Model loaded in {elapsed:.1f}s")
    return _pipeline


class HistoryBuffer:
    """Accumulates raw telemetry and downsamples to 1-minute intervals.

    Each station has its own HistoryBuffer instance — they never mix.
    """

    def __init__(self, station_id: str, downsample_seconds: int = DOWNSAMPLE_SECONDS):
        self.station_id = station_id
        self.downsample_seconds = downsample_seconds

        # Raw accumulator: signal_name → list of (timestamp, value)
        self._raw = collections.defaultdict(list)

        # Downsampled history: signal_name → deque of values (1 per minute)
        self._downsampled = {
            sig: collections.deque(maxlen=MAX_CONTEXT_LENGTH)
            for sig in FORECAST_SIGNALS
        }

        # Last downsample timestamp per signal
        self._last_ds_time = collections.defaultdict(float)

    def append(self, signal_name: str, value: float, timestamp: float = None):
        """Append a raw telemetry reading."""
        if signal_name not in FORECAST_SIGNALS:
            return
        if timestamp is None:
            timestamp = time.time()
        self._raw[signal_name].append((timestamp, value))
        self._maybe_downsample(signal_name, timestamp)

    def _maybe_downsample(self, signal_name: str, now: float):
        """Average raw readings into 1-minute samples."""
        last = self._last_ds_time[signal_name]
        if now - last < self.downsample_seconds:
            return

        raw = self._raw[signal_name]
        if not raw:
            return

        # Average all raw values accumulated in this window
        window_values = [v for t, v in raw if t > last]
        if window_values:
            avg = sum(window_values) / len(window_values)
            self._downsampled[signal_name].append(avg)
            self._last_ds_time[signal_name] = now

        # Trim raw buffer (keep only last 2 minutes)
        cutoff = now - self.downsample_seconds * 2
        self._raw[signal_name] = [(t, v) for t, v in raw if t > cutoff]

    def get_context(self, signal_name: str):
        """Return downsampled history as a torch tensor, or None if insufficient."""
        if not _check_chronos_available():
            return None
        ds = self._downsampled.get(signal_name)
        if ds is None or len(ds) < MIN_CONTEXT_LENGTH:
            return None
        return _torch.tensor(list(ds), dtype=_torch.float32)

    def context_length(self, signal_name: str) -> int:
        """Return current context length for a signal."""
        ds = self._downsampled.get(signal_name)
        return len(ds) if ds else 0

    def ready(self, signal_name: str) -> bool:
        """True if we have enough data points for this signal."""
        return self.context_length(signal_name) >= MIN_CONTEXT_LENGTH


class GenuineChronosForecaster:
    """Genuine Amazon Chronos-Bolt forecaster for Aurora.

    - Completely independent of existing decision/forecast/anomaly engines
    - Station-isolated history buffers
    - Non-blocking inference via cached results
    - Provides statistical forecast evidence only (no operational decisions)
    """

    def __init__(self):
        self._buffers = {}       # station_id → HistoryBuffer
        self._forecasts = {}     # station_id → {signal → forecast_result}
        self._forecast_time = {} # station_id → last forecast timestamp
        self._lock = threading.Lock()
        # Per-station inference guards (B10): acquired BEFORE the worker thread
        # starts, released in its `finally`. One station can never block or
        # skip another; a station never stacks a second inference on itself.
        self._station_locks = collections.defaultdict(threading.Lock)
        self._station_locks_guard = threading.Lock()

    def get_buffer(self, station_id: str) -> HistoryBuffer:
        """Get or create the history buffer for a station."""
        if station_id not in self._buffers:
            self._buffers[station_id] = HistoryBuffer(station_id)
        return self._buffers[station_id]

    def append_telemetry(self, station_id: str, values: dict, meta: dict = None):
        """Append current tick's telemetry to the station's history.

        Called every simulator tick. Extracts the signals we care about.

        Args:
            station_id: "maitri" or "bharati"
            values: dict of {building_id: {sensor_id: value}}
            meta: physics model metadata (gen_load_pct, fuel_rate, etc.)
        """
        buf = self.get_buffer(station_id)
        now = time.time()

        # Extract gen_temp_C from generator readings
        gen = values.get("generator", {})
        gen_temp = gen.get("gen_temp")
        if isinstance(gen_temp, dict):
            gen_temp = gen_temp.get("value")
        if gen_temp is not None:
            buf.append("gen_temp_C", float(gen_temp), now)

        # Fuel rate from the actual generator readings (B9: the physics `_meta`
        # never contains fuel_rate_Lhr, so the fuel buffer used to stay empty).
        fuel = gen.get("gen_fuel_rate")
        if isinstance(fuel, dict):
            fuel = fuel.get("value")
        if fuel is None and meta:
            fuel = meta.get("fuel_rate_Lhr")
        if fuel is not None:
            buf.append("fuel_rate_Lhr", float(fuel), now)

        # Generator load (percent) is only available from the physics meta
        if meta:
            load = meta.get("gen_load_pct")
            if load is not None:
                buf.append("gen_load_pct", float(load), now)

    def run_forecast(self, station_id: str) -> dict:
        """Run Chronos inference for all signals. Returns forecast dict.

        This is the expensive call (~1-2s on CPU). Should be called
        infrequently (every 5-10 minutes) and NOT on the tick thread.
        """
        if not _check_chronos_available():
            return {"available": False, "reason": "chronos-forecasting not installed"}

        pipeline = _load_pipeline()
        if pipeline is None:
            return {"available": False, "reason": "failed to load model"}

        buf = self.get_buffer(station_id)
        forecasts = {}

        for signal in FORECAST_SIGNALS:
            context = buf.get_context(signal)
            if context is None:
                forecasts[signal] = {
                    "available": False,
                    "reason": f"insufficient context ({buf.context_length(signal)}/{MIN_CONTEXT_LENGTH})",
                }
                continue

            try:
                # ChronosBoltPipeline.predict_quantiles uses `inputs` (not `context`)
                with _inference_lock:
                    quantiles, mean = pipeline.predict_quantiles(
                        inputs=context.unsqueeze(0),
                        prediction_length=PREDICTION_LENGTH,
                        quantile_levels=DEFAULT_QUANTILES,
                    )
                # quantiles shape: (1, prediction_length, num_quantiles)
                q = quantiles[0]  # Remove batch dim
                pred_len = q.shape[0]

                forecasts[signal] = {
                    "available": True,
                    "p10": [round(float(q[i, 0]), 2) for i in range(pred_len)],
                    "median": [round(float(q[i, 1]), 2) for i in range(pred_len)],
                    "p90": [round(float(q[i, 2]), 2) for i in range(pred_len)],
                    "context_length": buf.context_length(signal),
                    "horizon_minutes": [i + 1 for i in range(pred_len)],
                }
            except Exception as e:
                log.warning("[Chronos] predict_quantiles failed for %s/%s (%s); trying point forecast", station_id, signal, e)
                # Fallback: try predict() which returns point forecasts
                try:
                    with _inference_lock:
                        point_forecast = pipeline.predict(
                            inputs=context.unsqueeze(0),
                            prediction_length=PREDICTION_LENGTH,
                        )
                    # point_forecast shape: (1, prediction_length)
                    pf = point_forecast[0]
                    pred_len = pf.shape[0]

                    forecasts[signal] = {
                        "available": True,
                        "p10": [round(float(pf[i]) * 0.95, 2) for i in range(pred_len)],
                        "median": [round(float(pf[i]), 2) for i in range(pred_len)],
                        "p90": [round(float(pf[i]) * 1.05, 2) for i in range(pred_len)],
                        "context_length": buf.context_length(signal),
                        "horizon_minutes": [i + 1 for i in range(pred_len)],
                        "note": "fallback point forecast (quantiles approximated)",
                    }
                except Exception as e2:
                    log.warning("[Chronos] inference failed for %s/%s: %s", station_id, signal, e2)
                    forecasts[signal] = {
                        "available": False,
                        "reason": f"inference failed: {str(e2)}",
                    }

        result = {
            "available": True,
            "stationId": station_id,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "forecasts": forecasts,
            "provenance": {
                "model": MODEL_NAME,
                "type": "pretrained_foundation_model",
                "method": "zero-shot (no Aurora-specific fine-tuning)",
                "contextDuration": f"{buf.context_length(FORECAST_SIGNALS[0])} minutes",
                "forecastHorizon": f"{PREDICTION_LENGTH} minutes",
                "downsampleInterval": f"{DOWNSAMPLE_SECONDS}s",
                "note": "Statistical forecast from pretrained model. "
                        "Does not incorporate physics causality. "
                        "Compare with physics forecast for decision support.",
            },
        }

        # Cache the result
        with self._lock:
            self._forecasts[station_id] = result
            self._forecast_time[station_id] = time.time()

        return result

    def _station_lock(self, station_id: str) -> threading.Lock:
        with self._station_locks_guard:
            return self._station_locks[station_id]

    def run_forecast_async(self, station_id: str) -> bool:
        """Run forecast for one station in a background thread. Non-blocking.

        The station's lock is acquired HERE, before the thread starts, so two
        calls can never both pass the check (no race, no stacking). Returns
        True if a run was started, False if this station is already running."""
        lock = self._station_lock(station_id)
        if not lock.acquire(blocking=False):
            return False

        def _run():
            try:
                self.run_forecast(station_id)
            except Exception:
                log.exception("[%s] Chronos inference failed", station_id)
            finally:
                lock.release()

        try:
            threading.Thread(target=_run, daemon=True, name=f"chronos-{station_id}").start()
        except Exception:
            lock.release()
            raise
        return True

    def inference_running(self, station_id: str) -> bool:
        return self._station_lock(station_id).locked()

    def get_cached_forecast(self, station_id: str) -> dict:
        """Return the most recent cached forecast (non-blocking)."""
        with self._lock:
            result = self._forecasts.get(station_id)
            if result:
                age = time.time() - self._forecast_time.get(station_id, 0)
                result = dict(result)
                result["cacheAge_seconds"] = round(age, 1)
                return result

        # No cached result yet
        buf = self.get_buffer(station_id)
        status = {}
        for sig in FORECAST_SIGNALS:
            status[sig] = {
                "context_length": buf.context_length(sig),
                "ready": buf.ready(sig),
                "needed": MIN_CONTEXT_LENGTH,
            }
        return {
            "available": False,
            "stationId": station_id,
            "reason": "no forecast generated yet",
            "bufferStatus": status,
        }

    def status(self) -> dict:
        """Return overall status of the Chronos forecaster."""
        return {
            "chronos_available": _check_chronos_available(),
            "model": MODEL_NAME,
            "model_loaded": _pipeline is not None,
            "inference_running": {sid: self.inference_running(sid) for sid in self._buffers},
            "stations": {
                sid: {
                    sig: {
                        "context": buf.context_length(sig),
                        "ready": buf.ready(sig),
                    }
                    for sig in FORECAST_SIGNALS
                }
                for sid, buf in self._buffers.items()
            },
        }


# ═══════════════════════════════════════════════════════════════
#  Standalone test
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 60)
    print("  Genuine Chronos Forecaster — Self-Test")
    print("=" * 60)

    if not _check_chronos_available():
        print("\n  ❌ chronos-forecasting not installed.")
        print("  Install with: pip install chronos-forecasting torch")
        exit(1)

    print(f"\n  ✓ chronos-forecasting available")
    print(f"  Model: {MODEL_NAME}")

    # Create forecaster and fill with synthetic data
    forecaster = GenuineChronosForecaster()
    import math

    print(f"\n  Filling history buffer with {MIN_CONTEXT_LENGTH + 10} synthetic data points...")
    for i in range(MIN_CONTEXT_LENGTH + 10):
        # Synthetic gen_temp with trend + noise
        t = 60 + 5 * math.sin(i * 0.1) + (i * 0.05)
        forecaster.append_telemetry("maitri", {
            "generator": {"gen_temp": t}
        }, meta={
            "gen_load_pct": 40 + 3 * math.sin(i * 0.08),
            "fuel_rate_Lhr": 15 + math.sin(i * 0.12),
        })
        # Force downsample by advancing the clock
        buf = forecaster.get_buffer("maitri")
        for sig in FORECAST_SIGNALS:
            buf._last_ds_time[sig] = 0  # Force each append to downsample

    print(f"  Buffer status: {forecaster.status()}")

    print(f"\n  Running forecast...")
    result = forecaster.run_forecast("maitri")

    print(f"\n  Result:")
    import json
    print(json.dumps(result, indent=2))
