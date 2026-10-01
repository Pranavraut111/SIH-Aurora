#!/usr/bin/env python3
"""
Aurora — Anomaly Detection Engine (v3: physics-residual features)

Fixes PROJECT_CONTEXT.md B3 (continuous false positives). v2 was trained on
physics states that had not converged (3 warm-up ticks → gen_temp ≈ 44 °C) and
on 120 s ticks while live runs 2 s ticks, so every normal live state looked
anomalous. v3:

- FEATURES are physics residuals: for each monitored sensor,
      z = (observed − physics prediction for the SAME tick) / σ_sensor
  plus per-tick rates of those residuals. "Expected" therefore always means the
  digital twin's current prediction — never a training-set mean.
- RATE UNITS are "per physics tick". The physics model's dynamics are per
  compute() call (gen_temp moves 5 % of the way to its target per call,
  independent of dt or replay speed), so per-tick rates are the only unit that
  is invariant to AURORA_SPEED. Rates are taken on RESIDUALS, so weather changes
  (which do scale with speed) cannot leak into them.
- TRAINING uses the exact live code path: WeatherDataLayer.sample_at() (same
  interpolation + km/h wind conversion) → StationPhysicsModel.compute(dt=2 s)
  → FeatureEngine.extract(observed, predicted). Normal samples are recorded
  only after the physics state has converged.
- σ_sensor is an ASSUMED sensor-noise model (see anomaly_model_card.md).
  Training "observations" = prediction + N(0, σ).

Train (writes the .pkl files ONLY if acceptance criteria pass):
    python simulator/anomaly_engine.py            # train + evaluate + save if passing
    python simulator/anomaly_engine.py --dry-run  # train + evaluate, never save
Evaluate the saved models (never writes models):
    python simulator/evaluate_anomaly.py
"""

import collections
import json
import logging
import os
import pickle
import random
import re
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config as app_config
from physics_model import StationPhysicsModel

log = logging.getLogger("aurora.anomaly")

# ═══════════════════════════════════════════════════════════════
#  Constants shared by training, evaluation and live scoring
# ═══════════════════════════════════════════════════════════════

MODEL_VERSION = 3
SEED = 20260930

# Must equal simulator.TICK_INTERVAL (dt passed to physics compute() per tick).
# Asserted by tests/test_anomaly_model.py.
PHYSICS_TICK_DT_S = 2.0
# Replay speed used to generate training/evaluation data (the default AURORA_SPEED).
TRAIN_SPEED = 120.0

# Warm-up: physics gen_temp carries N(0, 0.2 °C) noise EVERY tick, so a raw
# |Δgen_temp| < 0.05 °C test for 20 consecutive ticks is practically never met
# (p ≈ 1e-17). We test the DETERMINISTIC drift instead: the physics model moves
# gen_temp by 0.05·(target − gen_temp) per tick; require that drift to be
# < 0.05 °C/tick for 20 consecutive ticks AND at least 200 ticks.
WARMUP_MIN_TICKS = 200
WARMUP_MAX_TICKS = 3000
CONVERGE_DRIFT_C = 0.05
CONVERGE_RUN_TICKS = 20
GEN_TEMP_APPROACH = 0.05  # per-tick approach factor used in physics_model.compute()

RATE_SHORT_TICKS = 3
RATE_LONG_TICKS = 10

# (building, sensor, assumed sensor noise σ in the sensor's unit)
RESIDUAL_SENSORS = [
    ("generator", "gen_temp", 0.5),          # °C
    ("generator", "gen_rpm", 5.0),           # rpm
    ("generator", "gen_power", 1.5),         # kW
    ("generator", "gen_fuel_rate", 0.3),     # L/hr
    ("heating", "heat_a_temp", 0.5),         # °C
    ("heating", "heat_a_flow", 0.3),         # L/min
    ("livingQuarters", "lq_temp", 0.2),      # °C
    ("livingQuarters", "lq_co2", 15.0),      # ppm
    ("livingQuarters", "lq_humidity", 1.0),  # %
    ("waterTank", "water_level", 0.5),       # %
]
NOISE_SIGMA = {s: sigma for _, s, sigma in RESIDUAL_SENSORS}
RATE_SENSORS_SHORT = ["gen_temp", "gen_rpm", "gen_fuel_rate", "heat_a_temp"]
RATE_SENSORS_LONG = ["gen_temp"]

RESIDUAL_FEATURES = [f"{s}_residual_z" for _, s, _ in RESIDUAL_SENSORS]
RATE_FEATURES = ([f"{s}_residual_z_rate_short" for s in RATE_SENSORS_SHORT]
                 + [f"{s}_residual_z_rate_long" for s in RATE_SENSORS_LONG])
ALL_FEATURES = RESIDUAL_FEATURES + RATE_FEATURES

EVIDENCE_MIN_SIGMA = 3.0

# Residual z-gate (tuning, see anomaly_model_card.md): Isolation-Forest scores
# saturate at the most extreme TRAINING point, so a huge deviation in one or two
# sensors (heating_failure, co2_spike: ~78σ) scores no higher than a 4σ noise
# point. Any |residual| ≥ 6σ is therefore also flagged. With 10 residuals per
# tick, the pure-noise false-alarm probability is ≈ 2e-8 per tick.
RESIDUAL_ALARM_SIGMA = 6.0
_RESIDUAL_IDX = [ALL_FEATURES.index(f) for f in RESIDUAL_FEATURES]


def _safe_val(obj, default=None):
    """Numeric value from a raw number or a {'value': …} reading."""
    if isinstance(obj, dict):
        obj = obj.get("value", default)
    return default if obj is None else float(obj)


def observed_from_readings(readings: dict) -> dict:
    """{building: {sensor: {'value': v, …}}} → {building: {sensor: v}} (like simulator.values)."""
    return {b: {s: _safe_val(r) for s, r in sensors.items()} for b, sensors in readings.items()}


# ═══════════════════════════════════════════════════════════════
#  Feature engine (identical for training, evaluation and live)
# ═══════════════════════════════════════════════════════════════

class FeatureEngine:
    """Residual features for one station, with a rolling buffer for per-tick rates."""

    def __init__(self, station_id: str):
        self.station_id = station_id
        self.buffer = collections.deque(maxlen=RATE_LONG_TICKS + 1)

    def reset(self):
        self.buffer.clear()

    def extract(self, observed: dict, predicted: dict) -> dict:
        """observed: sensor values as reported (post-injection in the demo).
        predicted: physics model readings for the SAME tick (the digital twin).
        Returns {feature: float} + '_details' (observed/expected per sensor)."""
        feats, details = {}, {}
        for bld, sensor, sigma in RESIDUAL_SENSORS:
            pred = _safe_val((predicted.get(bld) or {}).get(sensor), 0.0)
            obs = _safe_val((observed.get(bld) or {}).get(sensor), pred)
            resid = obs - pred
            feats[f"{sensor}_residual_z"] = resid / sigma
            details[sensor] = {"building": bld, "observed": obs, "expected": pred,
                               "residual": resid, "sigma": sigma}

        self.buffer.append({k: feats[k] for k in RESIDUAL_FEATURES})
        n = len(self.buffer)
        for s in RATE_SENSORS_SHORT:
            key = f"{s}_residual_z"
            feats[f"{key}_rate_short"] = ((self.buffer[-1][key] - self.buffer[-1 - RATE_SHORT_TICKS][key])
                                          / RATE_SHORT_TICKS if n > RATE_SHORT_TICKS else 0.0)
        for s in RATE_SENSORS_LONG:
            key = f"{s}_residual_z"
            feats[f"{key}_rate_long"] = ((self.buffer[-1][key] - self.buffer[-1 - RATE_LONG_TICKS][key])
                                         / RATE_LONG_TICKS if n > RATE_LONG_TICKS else 0.0)
        feats["_details"] = details
        return feats


def features_to_array(feat: dict) -> np.ndarray:
    return np.array([feat.get(k, 0.0) for k in ALL_FEATURES], dtype=float)


# Global per-station engines for live use (simulator.py)
_live_engines = {}
_warned_no_prediction = set()


def extract_features(weather: dict, readings: dict, meta: dict,
                     station_id: str = "maitri", predicted: dict = None) -> dict:
    """Live entry point used by simulator.py every tick.
    readings  = simulator.values (observed, post-injection)
    predicted = physics readings for this tick (pre-injection). If omitted,
                residuals are zero (logged once) — always pass it."""
    if predicted is None:
        if station_id not in _warned_no_prediction:
            _warned_no_prediction.add(station_id)
            log.warning("[%s] extract_features called without physics prediction; residuals will be 0", station_id)
        predicted = readings
    if station_id not in _live_engines:
        _live_engines[station_id] = FeatureEngine(station_id)
    return _live_engines[station_id].extract(readings, predicted)


# ═══════════════════════════════════════════════════════════════
#  Replay (the live tick path, without wall-clock time)
# ═══════════════════════════════════════════════════════════════

_CACHE_RE = re.compile(r"^(?P<station>[a-z]+)_(?P<start>\d{4}-\d{2}-\d{2})_(?P<end>\d{4}-\d{2}-\d{2})\.json$")


def cached_windows(stations=("maitri", "bharati")) -> list:
    """All (station, start_date) ERA5 replay windows present in weather_cache/."""
    out = []
    for f in sorted(app_config.WEATHER_CACHE_DIR.iterdir()):
        m = _CACHE_RE.match(f.name)
        if m and m.group("station") in stations:
            out.append((m.group("station"), m.group("start")))
    return out


def replay_states(station_id: str, date: str, speed: float = TRAIN_SPEED, seed: int = None):
    """Yield (tick, weather, predicted_readings, meta, physics_model) exactly as the
    live simulator produces them: weather sampled at tick·dt·speed simulated
    seconds, physics compute(dt=PHYSICS_TICK_DT_S). One pass over the window."""
    from weather_data import WeatherDataLayer
    if seed is not None:
        random.seed(seed)
    layer = WeatherDataLayer(station_id, date=date, speed_factor=speed)
    if not layer.fetch_and_cache():
        raise RuntimeError(f"No cached ERA5 window for {station_id} {date}")
    pm = StationPhysicsModel(station_id)
    hours_per_tick = PHYSICS_TICK_DT_S * speed / 3600.0
    n_ticks = int(layer.span_hours() / hours_per_tick)
    for t in range(n_ticks):
        weather = layer.sample_at(t * hours_per_tick)
        readings = pm.compute(weather, dt_seconds=PHYSICS_TICK_DT_S)
        meta = readings.pop("_meta")
        yield t, weather, readings, meta, pm


class ConvergenceTracker:
    """Warm-up gate: ≥ WARMUP_MIN_TICKS and deterministic gen_temp drift
    < CONVERGE_DRIFT_C for CONVERGE_RUN_TICKS consecutive ticks."""

    def __init__(self, station_id: str):
        g = StationPhysicsModel(station_id).params["generator"]
        self.base, self.rise, self.cool = g["coolant_base_temp_C"], g["temp_rise_per_load"], g["cooling_efficiency"]
        self.ticks = 0
        self.run = 0
        self.converged_at = None

    def update(self, pm, meta) -> bool:
        self.ticks += 1
        target = self.base + meta["gen_load_factor"] * self.rise / self.cool
        drift = abs(GEN_TEMP_APPROACH * (target - pm.gen_temp_C))
        self.run = self.run + 1 if drift < CONVERGE_DRIFT_C else 0
        if self.converged_at is None and (
                (self.ticks >= WARMUP_MIN_TICKS and self.run >= CONVERGE_RUN_TICKS)
                or self.ticks >= WARMUP_MAX_TICKS):
            self.converged_at = self.ticks
        return self.converged_at is not None


def add_sensor_noise(observed: dict, rng: np.random.Generator) -> dict:
    """observed + N(0, σ_sensor) on the monitored sensors (assumed sensor noise)."""
    out = {b: dict(s) for b, s in observed.items()}
    for bld, sensor, sigma in RESIDUAL_SENSORS:
        if sensor in out.get(bld, {}):
            out[bld][sensor] = out[bld][sensor] + rng.normal(0.0, sigma)
    return out


# ═══════════════════════════════════════════════════════════════
#  Synthetic degradations (applied to OBSERVED values vs the prediction)
# ═══════════════════════════════════════════════════════════════

DEGRADATION_RAMP_TICKS = 30      # severity ramps linearly 0 → max over 30 ticks, then holds
DEGRADATION_WINDOW_TICKS = 45    # detection window (ramp + 15 ticks hold)


def _scale(obs, pred_readings, bld, sensor, factor):
    base = _safe_val(pred_readings[bld][sensor])
    obs[bld][sensor] = obs[bld][sensor] - base + base * factor


def degrade_cooling(obs, pred, sev, rng):
    _scale(obs, pred, "generator", "gen_temp", 1 + sev)


def degrade_fuel(obs, pred, sev, rng):
    _scale(obs, pred, "generator", "gen_fuel_rate", 1 + sev)
    _scale(obs, pred, "generator", "gen_power", 1 - 0.3 * sev)


def degrade_heating(obs, pred, sev, rng):
    # Heating capacity loss: lower supply temperature and flow on Zone A.
    _scale(obs, pred, "heating", "heat_a_temp", 1 - sev)
    _scale(obs, pred, "heating", "heat_a_flow", 1 - sev)


def degrade_bearings(obs, pred, sev, rng):
    _scale(obs, pred, "generator", "gen_rpm", 1 - sev)
    obs["generator"]["gen_rpm"] += rng.normal(0.0, 20.0 * sev / 0.15)
    _scale(obs, pred, "generator", "gen_temp", 1 + 0.5 * sev)


DEGRADATIONS = {
    "cooling_degradation": degrade_cooling,
    "fuel_system_degradation": degrade_fuel,
    "heating_degradation": degrade_heating,
    "bearing_wear": degrade_bearings,
}


# ═══════════════════════════════════════════════════════════════
#  Detector
# ═══════════════════════════════════════════════════════════════

class AnomalyDetector:
    """Isolation Forest on physics-residual features.

    anomaly_score = original Isolation-Forest score s(x) ∈ (0, 1]
    (= −score_samples); ≈ 0.5 is the paper's boundary. NOT a probability.
    is_anomaly = anomaly_score ≥ threshold (calibrated on held-out normals).
    """

    SCORE_TYPE = "isolation_forest_path_score"

    # Candidate causes: (sensor, direction) pairs that must all deviate ≥ 3σ,
    # plus sensors that must stay within 3σ. Rule-based; reported separately
    # from detection and labelled as *possible* causes.
    CAUSE_SIGNATURES = {
        "generator_output_loss": {
            "description": "Possible generator output loss (power and RPM below physics prediction)",
            "require": [("gen_power", "below"), ("gen_rpm", "below")], "normal": [],
        },
        "bearing_wear": {
            "description": "Possible generator bearing wear (RPM low, temperature high)",
            "require": [("gen_rpm", "below"), ("gen_temp", "above")], "normal": ["gen_power"],
        },
        "cooling_degradation": {
            "description": "Possible generator cooling system degradation",
            "require": [("gen_temp", "above")], "normal": ["gen_rpm", "gen_power"],
        },
        "fuel_system_degradation": {
            "description": "Possible fuel injection efficiency loss",
            "require": [("gen_fuel_rate", "above")], "normal": ["gen_rpm"],
        },
        "heating_degradation": {
            "description": "Possible heating system capacity loss",
            "require": [("heat_a_temp", "below")], "normal": [],
        },
        "ventilation_degradation": {
            "description": "Possible ventilation failure (CO2 above physics prediction)",
            "require": [("lq_co2", "above")], "normal": [],
        },
    }

    def __init__(self, station_id: str):
        self.station_id = station_id
        self.model = None
        self.threshold = 0.5
        self.feature_names = list(ALL_FEATURES)
        self.metadata = {}
        self.is_trained = False

    # ── training ──────────────────────────────────────────────
    def train(self, X: np.ndarray, seed: int = SEED, n_estimators: int = 300, max_samples: int = 512):
        from sklearn.ensemble import IsolationForest
        self.model = IsolationForest(n_estimators=n_estimators, max_samples=max_samples,
                                     contamination="auto", random_state=seed)
        self.model.fit(X)
        self.is_trained = True

    def scores(self, X: np.ndarray) -> np.ndarray:
        return -self.model.score_samples(np.atleast_2d(X))

    def flags(self, X: np.ndarray) -> np.ndarray:
        """Batch decision: Isolation-Forest score ≥ threshold OR any residual ≥ 6σ."""
        X = np.atleast_2d(X)
        return (self.scores(X) >= self.threshold) | (np.abs(X[:, _RESIDUAL_IDX]).max(axis=1) >= RESIDUAL_ALARM_SIGMA)

    def calibrate(self, X_val_normal: np.ndarray, quantile: float, margin: float):
        s = self.scores(X_val_normal)
        self.threshold = float(max(np.quantile(s, quantile) + margin, 0.5))
        return self.threshold

    # ── live scoring ──────────────────────────────────────────
    def explain(self, features: dict, is_anomaly: bool):
        """Evidence (vs the physics prediction for the same tick) + candidate causes."""
        details = features.get("_details", {})
        z = {sensor: d["residual"] / d["sigma"] for sensor, d in details.items()}
        evidence = []
        for sensor, d in details.items():
            if abs(z[sensor]) >= EVIDENCE_MIN_SIGMA:
                evidence.append({
                    "sensor": sensor,
                    "value": round(d["observed"], 2),
                    "expected": round(d["expected"], 2),          # physics prediction, same tick
                    "residual": round(d["residual"], 2),
                    "deviation_sigma": round(z[sensor], 1),
                    "direction": "above" if z[sensor] > 0 else "below",
                    "contribution": round(abs(z[sensor]), 2),
                    "expectedSource": "physics model prediction (same tick)",
                })
        evidence.sort(key=lambda e: e["contribution"], reverse=True)

        candidate_causes = []
        if is_anomaly:
            for cause, sig in self.CAUSE_SIGNATURES.items():
                ok = all((z.get(s, 0) >= EVIDENCE_MIN_SIGMA) if d == "above" else (z.get(s, 0) <= -EVIDENCE_MIN_SIGMA)
                         for s, d in sig["require"])
                ok = ok and all(abs(z.get(s, 0)) < EVIDENCE_MIN_SIGMA for s in sig["normal"])
                if ok:
                    strength = float(np.mean([abs(z[s]) for s, _ in sig["require"]]))
                    candidate_causes.append({
                        "cause": cause,
                        "description": sig["description"],
                        "confidence": round(min(1.0, strength / 10.0), 2),
                        "matchingSensors": [s for s, _ in sig["require"]],
                    })
            candidate_causes.sort(key=lambda c: c["confidence"], reverse=True)
        return evidence[:5], candidate_causes[:3]

    def score(self, features: dict) -> dict:
        if not self.is_trained:
            return {"anomaly_score": 0, "scoreType": self.SCORE_TYPE, "threshold": self.threshold,
                    "is_anomaly": False, "evidence": [], "candidateCauses": []}
        x = features_to_array(features)
        s = float(self.scores(x)[0])
        max_z = float(np.abs(x[_RESIDUAL_IDX]).max())
        triggered = []
        if s >= self.threshold:
            triggered.append("isolation_forest")
        if max_z >= RESIDUAL_ALARM_SIGMA:
            triggered.append("residual_z")
        is_anomaly = bool(triggered)
        evidence, causes = self.explain(features, is_anomaly)
        return {
            "anomaly_score": round(s, 3),
            "scoreType": self.SCORE_TYPE,
            "threshold": round(self.threshold, 3),
            "maxResidualSigma": round(max_z, 1),
            "residualAlarmSigma": RESIDUAL_ALARM_SIGMA,
            "triggeredBy": triggered,
            "is_anomaly": bool(is_anomaly),
            "evidence": evidence,
            "candidateCauses": causes,
            # every monitored sensor: observed vs physics prediction (same tick)
            "residuals": [
                {"sensor": sensor, "building": d["building"], "observed": round(d["observed"], 2),
                 "expected": round(d["expected"], 2), "residual": round(d["residual"], 2),
                 "sigma": d["sigma"], "z": round(d["residual"] / d["sigma"], 2)}
                for sensor, d in features.get("_details", {}).items()
            ],
        }

    # ── persistence ───────────────────────────────────────────
    def save(self, path: str):
        with open(path, "wb") as f:
            pickle.dump({
                "model_version": MODEL_VERSION, "model": self.model, "threshold": self.threshold,
                "station_id": self.station_id, "feature_names": self.feature_names,
                "metadata": self.metadata,
            }, f)

    def load(self, path: str):
        with open(path, "rb") as f:
            data = pickle.load(f)
        if data.get("model_version") != MODEL_VERSION or data.get("feature_names") != ALL_FEATURES:
            raise ValueError(f"{path} is not a v{MODEL_VERSION} residual model "
                             "(retrain: python simulator/anomaly_engine.py)")
        self.model = data["model"]
        self.threshold = data["threshold"]
        self.station_id = data["station_id"]
        self.feature_names = data["feature_names"]
        self.metadata = data.get("metadata", {})
        self.is_trained = True


# ═══════════════════════════════════════════════════════════════
#  Training
# ═══════════════════════════════════════════════════════════════

CALIBRATION_QUANTILE = 0.999
CALIBRATION_MARGIN = 0.02


def collect_normal(station_id: str, date: str, seed: int):
    """Converged normal feature vectors for one replay window
    (observed = physics prediction + assumed sensor noise)."""
    rng = np.random.default_rng(seed)
    fe, conv = FeatureEngine(station_id), ConvergenceTracker(station_id)
    X, n_warmup = [], 0
    for _t, _weather, readings, meta, pm in replay_states(station_id, date, seed=seed):
        if not conv.update(pm, meta):
            n_warmup += 1
            continue
        observed = add_sensor_noise(observed_from_readings(readings), rng)
        X.append(features_to_array(fe.extract(observed, readings)))
    return np.array(X), {"warmup_ticks": n_warmup, "samples": len(X), "converged_at": conv.converged_at}


def train_station(station_id: str, seed: int = SEED):
    windows = [d for _, d in cached_windows((station_id,))]
    blocks, summary = [], {}
    for i, date in enumerate(windows):
        X, info = collect_normal(station_id, date, seed + i)
        blocks.append(X)
        summary[date] = info
    X = np.vstack(blocks)
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(X))
    n_val = int(0.2 * len(X))
    X_val, X_train = X[idx[:n_val]], X[idx[n_val:]]

    det = AnomalyDetector(station_id)
    det.train(X_train, seed=seed)
    det.calibrate(X_val, CALIBRATION_QUANTILE, CALIBRATION_MARGIN)
    import sklearn
    det.metadata = {
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sklearn_version": sklearn.__version__,
        "seed": seed,
        "speed": TRAIN_SPEED,
        "physics_tick_dt_s": PHYSICS_TICK_DT_S,
        "windows": summary,
        "n_train": int(len(X_train)),
        "n_val": int(len(X_val)),
        "calibration": {"quantile": CALIBRATION_QUANTILE, "margin": CALIBRATION_MARGIN,
                        "threshold": det.threshold},
        "noise_sigma": NOISE_SIGMA,
        "residual_alarm_sigma": RESIDUAL_ALARM_SIGMA,
        "features": ALL_FEATURES,
    }
    return det


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description="Train v3 residual anomaly models")
    ap.add_argument("--dry-run", action="store_true", help="train + evaluate, never write .pkl files")
    ap.add_argument("--metrics-out", help="write evaluation metrics JSON here (never a model file)")
    args = ap.parse_args(argv)

    random.seed(SEED)
    np.random.seed(SEED)
    detectors = {}
    for sid in ("maitri", "bharati"):
        t0 = time.time()
        detectors[sid] = train_station(sid)
        md = detectors[sid].metadata
        print(f"[{sid}] trained on {md['n_train']} normal states "
              f"({len(md['windows'])} windows), threshold={detectors[sid].threshold:.3f} "
              f"in {time.time() - t0:.1f}s")

    from evaluate_anomaly import criteria_pass, evaluate, format_report
    metrics = evaluate(detectors)
    print(format_report(metrics))
    if args.metrics_out:
        with open(args.metrics_out, "w") as f:
            json.dump({"metrics": metrics, "training": {s: d.metadata for s, d in detectors.items()}},
                      f, indent=2, default=str)

    ok, failures = criteria_pass(metrics)
    if not ok:
        print("\nACCEPTANCE CRITERIA NOT MET — models NOT saved:")
        for f in failures:
            print("  -", f)
        return 1
    if args.dry_run:
        print("\nCriteria met (dry run) — models NOT saved.")
        return 0
    for sid, det in detectors.items():
        det.save(str(app_config.anomaly_model_path(sid)))
        print(f"Saved {app_config.anomaly_model_path(sid)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
