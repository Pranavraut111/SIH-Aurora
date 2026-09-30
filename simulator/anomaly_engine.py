#!/usr/bin/env python3
"""
Aurora v3 — Phase 3: Anomaly Detection Engine (v2)

Improvements over v1:
  - Temporal features: rate-of-change over 5/15 min windows
  - Physics residual features: actual vs expected from twin
  - Threshold-vs-detection curve analysis
  - Proper train / validation / final-test split
  - Separate anomaly detection from cause classification metrics
  - Sequential degradation generation (gradual onset)

Architecture:
    ERA5 weather → Physics Twin → Expected State
                                        ↓
                                 Feature Engine
                     ┌──────────────────┼──────────────────┐
                     ↓                  ↓                  ↓
               absolute dev       rate of change      residual vs model
                     ↓                  ↓                  ↓
                     └──────────────────┼──────────────────┘
                                        ↓
                                 Anomaly Detector
                                        ↓
                              temporal evidence
                                        ↓
                              candidate causes
"""

import sys, os, json, random, pickle, collections
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))

from physics_model import StationPhysicsModel

# ═══════════════════════════════════════════════════════
#  Feature definitions
# ═══════════════════════════════════════════════════════

# Base features (instantaneous)
BASE_FEATURES = [
    "env_temp", "env_wind",
    "heat_loss_kW", "heating_demand_kW",
    "total_demand_kW", "gen_load_pct",
    "gen_temp_C", "fuel_rate_Lhr", "gen_rpm",
]

# Physics-derived ratio features
RATIO_FEATURES = [
    "fuel_per_kW",       # fuel efficiency ratio
    "temp_per_load",     # thermal efficiency ratio
]

# Residual features: actual − expected from physics model
RESIDUAL_FEATURES = [
    "gen_temp_residual",   # gen_temp − f(load)
    "fuel_residual",       # fuel_rate − f(demand)
    "rpm_residual",        # rpm − nominal
]

# Temporal features: rate of change
TEMPORAL_FEATURES = [
    "gen_temp_rate_5m",    # °C / 5 minutes
    "gen_temp_rate_15m",   # °C / 15 minutes
    "fuel_rate_rate_5m",   # L/hr per 5 min
    "rpm_rate_5m",         # RPM per 5 min
    "load_rate_5m",        # pct per 5 min
]

ALL_FEATURES = BASE_FEATURES + RATIO_FEATURES + RESIDUAL_FEATURES + TEMPORAL_FEATURES


def _safe_val(obj, default=0):
    """Extract numeric value from possibly-dict sensor reading."""
    if isinstance(obj, dict):
        return obj.get("value", default)
    return obj if obj is not None else default


class FeatureEngine:
    """Extracts features from physics model output, including temporal features.

    Maintains a rolling buffer for rate-of-change computation.
    """

    def __init__(self, station_id: str, tick_interval_sec: float = 120):
        self.station_id = station_id
        self.tick_interval_sec = tick_interval_sec
        # Rolling buffer: stores recent base feature dicts
        # At 120s ticks: 5min = ~2-3 entries, 15min = ~7-8 entries
        self.buffer = collections.deque(maxlen=10)

        # Load physics model parameters for residual calculation
        pm = StationPhysicsModel(station_id)
        self.gen_params = pm.params["generator"]

    def extract(self, weather: dict, readings: dict, meta: dict) -> dict:
        """Extract full feature vector (base + ratio + residual + temporal)."""
        pb = meta.get("power_breakdown", {})

        gen = readings.get("generator", {})
        gen_temp = _safe_val(gen.get("gen_temp"))
        fuel_rate = _safe_val(gen.get("gen_fuel_rate"))
        gen_rpm = _safe_val(gen.get("gen_rpm"), 1500)
        gen_power = _safe_val(gen.get("gen_power"))

        total_demand = pb.get("total_demand_kW", 70)
        gen_load = meta.get("gen_load_pct", 35)

        # ── Base features ──────────────────────────────────
        base = {
            "env_temp": weather.get("env_temp", -20),
            "env_wind": weather.get("env_wind", 30),
            "heat_loss_kW": meta.get("total_heat_loss_kW", 0),
            "heating_demand_kW": meta.get("heating_demand_kW", 0),
            "total_demand_kW": total_demand,
            "gen_load_pct": gen_load,
            "gen_temp_C": gen_temp,
            "fuel_rate_Lhr": fuel_rate,
            "gen_rpm": gen_rpm,
        }

        # ── Ratio features ─────────────────────────────────
        base["fuel_per_kW"] = fuel_rate / max(gen_power, 1)
        base["temp_per_load"] = gen_temp / max(gen_load, 1)

        # ── Residual features (actual − physics expected) ──
        # Expected gen temp from Willans thermal model
        load_frac = gen_load / 100.0
        expected_temp = (self.gen_params["coolant_base_temp_C"] +
                        load_frac * self.gen_params["temp_rise_per_load"] /
                        self.gen_params["cooling_efficiency"])
        base["gen_temp_residual"] = gen_temp - expected_temp

        # Expected fuel from Willans line
        expected_fuel = (self.gen_params["fuel_coeff_a"] +
                        self.gen_params["fuel_coeff_b"] * total_demand)
        base["fuel_residual"] = fuel_rate - expected_fuel

        # RPM residual from nominal
        base["rpm_residual"] = gen_rpm - self.gen_params["nominal_rpm"]

        # ── Temporal features (rate of change) ──────────────
        if len(self.buffer) >= 2:
            # 5-minute rate (last ~2-3 entries at 120s ticks)
            idx_5m = max(0, len(self.buffer) - 3)
            old = self.buffer[idx_5m]
            dt_min = (len(self.buffer) - idx_5m) * self.tick_interval_sec / 60
            dt_min = max(dt_min, 0.01)
            base["gen_temp_rate_5m"] = (gen_temp - old["gen_temp_C"]) / dt_min
            base["fuel_rate_rate_5m"] = (fuel_rate - old["fuel_rate_Lhr"]) / dt_min
            base["rpm_rate_5m"] = (gen_rpm - old["gen_rpm"]) / dt_min
            base["load_rate_5m"] = (gen_load - old["gen_load_pct"]) / dt_min

            # 15-minute rate (all buffer at 120s ticks ≈ 20 min window)
            old_15 = self.buffer[0]
            dt_15 = len(self.buffer) * self.tick_interval_sec / 60
            dt_15 = max(dt_15, 0.01)
            base["gen_temp_rate_15m"] = (gen_temp - old_15["gen_temp_C"]) / dt_15
        else:
            base["gen_temp_rate_5m"] = 0
            base["fuel_rate_rate_5m"] = 0
            base["rpm_rate_5m"] = 0
            base["load_rate_5m"] = 0
            base["gen_temp_rate_15m"] = 0

        # Update buffer
        self.buffer.append(dict(base))

        return base

    def reset(self):
        """Clear temporal buffer for independent sample generation."""
        self.buffer.clear()


def features_to_array(feat: dict) -> np.ndarray:
    """Convert feature dict to numpy array in canonical order."""
    return np.array([feat.get(k, 0) for k in ALL_FEATURES])


# ═══════════════════════════════════════════════════════
#  Data generation
# ═══════════════════════════════════════════════════════

def generate_normal_sequences(station_id: str, n_sequences: int = 500,
                               seq_length: int = 8) -> list:
    """Generate sequences of normal operating states.

    Each sequence is a short time-series at consistent weather,
    allowing temporal features to build up naturally.
    """
    pm = StationPhysicsModel(station_id)
    fe = FeatureEngine(station_id)
    data = []

    temps = np.linspace(-55, 0, 30)
    winds = np.linspace(2, 100, 25)

    for _ in range(n_sequences):
        temp = float(np.random.choice(temps)) + random.gauss(0, 3)
        wind = max(0, float(np.random.choice(winds)) + random.gauss(0, 5))

        pm.reset_state()
        fe.reset()

        weather = {
            "env_temp": temp, "env_wind": wind,
            "env_pressure": 950 + random.gauss(0, 15),
            "env_humidity": 60 + random.gauss(0, 15),
        }

        # Let model converge (3 warm-up ticks, not recorded)
        for _ in range(3):
            readings = pm.compute(weather, dt_seconds=120)
            meta = readings.pop("_meta", {})
            fe.extract(weather, readings, meta)

        # Record seq_length ticks (slightly varying weather)
        for t in range(seq_length):
            w = dict(weather)
            w["env_temp"] += random.gauss(0, 0.3)
            w["env_wind"] = max(0, w["env_wind"] + random.gauss(0, 1))
            readings = pm.compute(w, dt_seconds=120)
            meta = readings.pop("_meta", {})
            feat = fe.extract(w, readings, meta)
            feat["label"] = "normal"
            data.append(feat)

    return data


def generate_degradation_sequences(station_id: str, n_sequences: int = 150,
                                     seq_length: int = 8) -> list:
    """Generate sequential degradation scenarios with gradual onset.

    Each sequence starts normal and progressively degrades,
    producing temporal signatures (rising gen_temp, falling RPM, etc).
    """
    pm = StationPhysicsModel(station_id)
    fe = FeatureEngine(station_id)
    data = []

    degradation_types = [
        {"name": "cooling_degradation",
         "description": "Generator cooling system losing efficiency",
         "apply": lambda r, m, sev: _degrade_cooling(r, m, sev)},
        {"name": "fuel_system_degradation",
         "description": "Fuel injection becoming less efficient",
         "apply": lambda r, m, sev: _degrade_fuel(r, m, sev)},
        {"name": "heating_degradation",
         "description": "Heating system losing output capacity",
         "apply": lambda r, m, sev: _degrade_heating(r, m, sev)},
        {"name": "bearing_wear",
         "description": "Generator bearing wear causing RPM instability",
         "apply": lambda r, m, sev: _degrade_bearings(r, m, sev)},
    ]

    for _ in range(n_sequences):
        temp = random.uniform(-50, -5) + random.gauss(0, 3)
        wind = max(0, random.uniform(5, 80) + random.gauss(0, 5))
        weather = {
            "env_temp": temp, "env_wind": wind,
            "env_pressure": 950 + random.gauss(0, 15),
            "env_humidity": 60 + random.gauss(0, 15),
        }

        deg = random.choice(degradation_types)
        max_severity = random.uniform(0.15, 0.45)

        pm.reset_state()
        fe.reset()

        # Warm up
        for _ in range(3):
            readings = pm.compute(weather, dt_seconds=120)
            meta = readings.pop("_meta", {})
            fe.extract(weather, readings, meta)

        # Gradual degradation over seq_length ticks
        for t in range(seq_length):
            w = dict(weather)
            w["env_temp"] += random.gauss(0, 0.3)
            w["env_wind"] = max(0, w["env_wind"] + random.gauss(0, 1))

            readings = pm.compute(w, dt_seconds=120)
            meta = readings.pop("_meta", {})

            # Severity ramps from 0 → max over the sequence
            severity = max_severity * (t / max(seq_length - 1, 1))
            readings, meta = deg["apply"](readings, meta, severity)

            feat = fe.extract(w, readings, meta)
            feat["label"] = deg["name"]
            feat["degradation_type"] = deg["name"]
            feat["severity"] = severity
            feat["tick_in_sequence"] = t
            data.append(feat)

    return data


def _degrade_cooling(readings, meta, severity):
    gen = readings.get("generator", {})
    gt = gen.get("gen_temp", {})
    if isinstance(gt, dict):
        gt["value"] *= (1 + severity)
    else:
        gen["gen_temp"] = (gt or 60) * (1 + severity)
    return readings, meta


def _degrade_fuel(readings, meta, severity):
    gen = readings.get("generator", {})
    fr = gen.get("gen_fuel_rate", {})
    if isinstance(fr, dict):
        fr["value"] *= (1 + severity)
    else:
        gen["gen_fuel_rate"] = (fr or 15) * (1 + severity)
    gp = gen.get("gen_power", {})
    if isinstance(gp, dict):
        gp["value"] *= (1 - severity * 0.3)
    return readings, meta


def _degrade_heating(readings, meta, severity):
    meta["heating_demand_kW"] = meta.get("heating_demand_kW", 15) * (1 + severity)
    pb = meta.get("power_breakdown", {})
    pb["total_demand_kW"] = pb.get("total_demand_kW", 70) * (1 + severity * 0.5)
    meta["gen_load_pct"] = meta.get("gen_load_pct", 35) * (1 + severity * 0.5)
    return readings, meta


def _degrade_bearings(readings, meta, severity):
    gen = readings.get("generator", {})
    rpm = gen.get("gen_rpm", {})
    if isinstance(rpm, dict):
        rpm["value"] *= (1 - severity)
        rpm["value"] += random.gauss(0, 20 * severity / 0.15)
    else:
        gen["gen_rpm"] = (rpm or 1500) * (1 - severity) + random.gauss(0, 20)
    gt = gen.get("gen_temp", {})
    if isinstance(gt, dict):
        gt["value"] *= (1 + severity * 0.5)
    return readings, meta


# ═══════════════════════════════════════════════════════
#  Anomaly Detector
# ═══════════════════════════════════════════════════════

class AnomalyDetector:
    """Physics-informed anomaly detection with temporal features.

    Trained on normal operating sequences from the digital twin.
    Scores new observations against the learned baseline.
    Reports which sensors contribute most to the anomaly.

    Score definition:
        scoreType: normalized_isolation_forest
        NOT a probability.
        0.0 = clearly within normal operating envelope
        0.5 = boundary of normal
        1.0 = strongly outside normal operating envelope
    """

    SCORE_TYPE = "normalized_isolation_forest"

    # Candidate cause signatures (rule-based, separate from anomaly detection)
    CAUSE_SIGNATURES = {
        "cooling_degradation": {
            "description": "Possible generator cooling system degradation",
            "key_sensors": ["gen_temp_C", "gen_temp_residual", "temp_per_load", "gen_temp_rate_5m"],
            "pattern": {"gen_temp_residual": "above", "temp_per_load": "above"},
        },
        "fuel_system_degradation": {
            "description": "Possible fuel injection efficiency loss",
            "key_sensors": ["fuel_rate_Lhr", "fuel_residual", "fuel_per_kW"],
            "pattern": {"fuel_residual": "above", "fuel_per_kW": "above"},
        },
        "bearing_wear": {
            "description": "Possible generator bearing wear",
            "key_sensors": ["gen_rpm", "rpm_residual", "rpm_rate_5m", "gen_temp_C"],
            "pattern": {"rpm_residual": "below", "gen_temp_residual": "above"},
        },
        "heating_degradation": {
            "description": "Possible heating system capacity loss",
            "key_sensors": ["heating_demand_kW", "total_demand_kW", "gen_load_pct"],
            "pattern": {"heating_demand_kW": "above", "gen_load_pct": "above"},
        },
    }

    def __init__(self, station_id: str):
        self.station_id = station_id
        self.model = None
        self.scaler = None
        self.normal_means = None
        self.normal_stds = None
        self.feature_names = ALL_FEATURES
        self.is_trained = False
        self.threshold = 0.5  # default, may be tuned

    def train(self, normal_data: list, threshold: float = None):
        """Train on normal physics-derived operating states ONLY."""
        from sklearn.ensemble import IsolationForest
        from sklearn.preprocessing import StandardScaler

        X = np.array([features_to_array(d) for d in normal_data])

        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)

        self.normal_means = X.mean(axis=0)
        self.normal_stds = X.std(axis=0) + 1e-8

        self.model = IsolationForest(
            n_estimators=200,
            contamination=0.05,
            random_state=42,
            max_features=0.8,
        )
        self.model.fit(X_scaled)
        self.is_trained = True

        if threshold is not None:
            self.threshold = threshold

        print(f"  [{self.station_id}] Trained on {len(normal_data)} normal states, "
              f"{len(self.feature_names)} features")

    def score(self, features: dict) -> dict:
        """Score a single observation.

        ANOMALY DETECTION: is this observation outside normal?
        CAUSE CLASSIFICATION: given anomaly, which synthetic signature matches?
        These are reported as SEPARATE outputs.
        """
        if not self.is_trained:
            return {
                "anomaly_score": 0, "scoreType": self.SCORE_TYPE,
                "threshold": self.threshold,
                "is_anomaly": False, "evidence": [], "candidateCauses": [],
            }

        x = features_to_array(features).reshape(1, -1)
        x_scaled = self.scaler.transform(x)

        raw_score = self.model.decision_function(x_scaled)[0]
        anomaly_score = max(0, min(1, 0.5 - raw_score))
        is_anomaly = anomaly_score >= self.threshold

        # Evidence
        deviations = (x[0] - self.normal_means) / self.normal_stds
        evidence = []
        evidence_by_sensor = {}
        for i, name in enumerate(self.feature_names):
            dev = float(deviations[i])
            direction = "above" if dev > 0 else "below"
            evidence_by_sensor[name] = {"sigma": dev, "direction": direction}
            if abs(dev) > 1.5:
                evidence.append({
                    "sensor": name,
                    "value": round(float(x[0][i]), 2),
                    "expected": round(float(self.normal_means[i]), 2),
                    "deviation_sigma": round(dev, 1),
                    "direction": direction,
                    "contribution": round(abs(dev), 2),
                })
        evidence.sort(key=lambda e: e["contribution"], reverse=True)

        # Cause classification (separate from detection)
        candidate_causes = []
        if is_anomaly:
            for cause_id, sig in self.CAUSE_SIGNATURES.items():
                match_score = 0
                for sensor, exp_dir in sig["pattern"].items():
                    if sensor in evidence_by_sensor:
                        actual = evidence_by_sensor[sensor]
                        if actual["direction"] == exp_dir and abs(actual["sigma"]) > 1.0:
                            match_score += abs(actual["sigma"])
                total_keys = len(sig["pattern"])
                confidence = min(1.0, match_score / (total_keys * 3))
                if confidence > 0.1:
                    candidate_causes.append({
                        "cause": cause_id,
                        "description": sig["description"],
                        "confidence": round(confidence, 2),
                        "matchingSensors": [
                            s for s in sig["key_sensors"]
                            if s in evidence_by_sensor
                            and abs(evidence_by_sensor[s]["sigma"]) > 1.0
                        ],
                    })
            candidate_causes.sort(key=lambda c: c["confidence"], reverse=True)

        return {
            "anomaly_score": round(float(anomaly_score), 3),
            "scoreType": self.SCORE_TYPE,
            "threshold": self.threshold,
            "is_anomaly": bool(is_anomaly),
            "evidence": evidence[:5],
            "candidateCauses": candidate_causes[:3],
        }

    def save(self, path: str):
        with open(path, "wb") as f:
            pickle.dump({
                "model": self.model, "scaler": self.scaler,
                "normal_means": self.normal_means, "normal_stds": self.normal_stds,
                "station_id": self.station_id, "feature_names": self.feature_names,
                "threshold": self.threshold,
            }, f)

    def load(self, path: str):
        with open(path, "rb") as f:
            data = pickle.load(f)
        self.model = data["model"]
        self.scaler = data["scaler"]
        self.normal_means = data["normal_means"]
        self.normal_stds = data["normal_stds"]
        self.station_id = data["station_id"]
        self.feature_names = data.get("feature_names", ALL_FEATURES)
        self.threshold = data.get("threshold", 0.5)
        self.is_trained = True


# ═══════════════════════════════════════════════════════
#  extract_features — backward compatible with simulator
# ═══════════════════════════════════════════════════════

# Global feature engines for live use
_live_engines = {}

def extract_features(weather: dict, readings: dict, meta: dict,
                     station_id: str = "maitri") -> dict:
    """Extract features for live scoring (backward compatible)."""
    if station_id not in _live_engines:
        _live_engines[station_id] = FeatureEngine(station_id)
    return _live_engines[station_id].extract(weather, readings, meta)


# ═══════════════════════════════════════════════════════
#  Training, Threshold Analysis & Evaluation
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    for station in ["maitri", "bharati"]:
        print(f"\n{'='*70}")
        print(f"  ANOMALY MODEL v2 — {station.upper()}")
        print(f"{'='*70}")

        # ── Data Generation ──────────────────────────────────
        print("\n  DATA GENERATION (sequential)")
        normal = generate_normal_sequences(station, n_sequences=500, seq_length=8)
        print(f"    Normal: {len(normal)} states from 500 sequences")

        degraded = generate_degradation_sequences(station, n_sequences=200, seq_length=8)
        print(f"    Degradation: {len(degraded)} states from 200 sequences (held out)")

        # ── 3-way split: train / validation / final-test ─────
        random.shuffle(normal)
        n = len(normal)
        n_train = int(n * 0.60)
        n_val = int(n * 0.20)
        normal_train = normal[:n_train]
        normal_val = normal[n_train:n_train + n_val]
        normal_test = normal[n_train + n_val:]

        random.shuffle(degraded)
        nd = len(degraded)
        deg_val = degraded[:nd // 2]
        deg_test = degraded[nd // 2:]

        print(f"\n  DATA SPLIT")
        print(f"    Training:    {len(normal_train)} normal states")
        print(f"    Validation:  {len(normal_val)} normal + {len(deg_val)} degraded")
        print(f"    Final test:  {len(normal_test)} normal + {len(deg_test)} degraded")
        print(f"    Degradation is NEVER used for training")

        # ── Train ────────────────────────────────────────────
        print(f"\n  TRAINING")
        detector = AnomalyDetector(station)
        detector.train(normal_train)
        print(f"    Features: {len(ALL_FEATURES)} "
              f"({len(BASE_FEATURES)} base + {len(RATIO_FEATURES)} ratio + "
              f"{len(RESIDUAL_FEATURES)} residual + {len(TEMPORAL_FEATURES)} temporal)")

        # ── Threshold Analysis (on VALIDATION set) ───────────
        print(f"\n  THRESHOLD ANALYSIS (validation set)")
        print(f"    {'Threshold':>10s} {'Detection':>10s} {'FPR':>8s} {'FNR':>8s}")
        print(f"    {'─'*10} {'─'*10} {'─'*8} {'─'*8}")

        best_threshold = 0.5
        best_f1 = 0

        for threshold in [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60]:
            fp = sum(1 for d in normal_val
                     if detector.score(d)["anomaly_score"] >= threshold)
            tp = sum(1 for d in deg_val
                     if detector.score(d)["anomaly_score"] >= threshold)
            fn = len(deg_val) - tp

            fpr_t = fp / max(len(normal_val), 1)
            det_t = tp / max(len(deg_val), 1)
            fnr_t = fn / max(len(deg_val), 1)

            precision = tp / max(tp + fp, 1)
            recall = det_t
            f1 = 2 * precision * recall / max(precision + recall, 0.001)

            print(f"    {threshold:10.2f} {det_t*100:9.1f}% {fpr_t*100:7.1f}% {fnr_t*100:7.1f}%")

            if f1 > best_f1:
                best_f1 = f1
                best_threshold = threshold

        print(f"\n    Selected threshold: {best_threshold} (best F1={best_f1:.3f} on validation)")
        detector.threshold = best_threshold

        # ── Final Test (UNTOUCHED until now) ──────────────────
        print(f"\n  FINAL TEST (independent test set, threshold={best_threshold})")

        # Normal test
        fp_final = 0
        for d in normal_test:
            result = detector.score(d)
            if result["is_anomaly"]:
                fp_final += 1
        fpr_final = fp_final / max(len(normal_test), 1)
        print(f"\n    ANOMALY DETECTION (is something abnormal?)")
        print(f"    Normal: FP={fp_final}/{len(normal_test)} FPR={fpr_final*100:.1f}%")

        # Degradation test — per type
        deg_by_type = {}
        all_tp = 0
        for d in deg_test:
            dtype = d.get("degradation_type", "unknown")
            if dtype not in deg_by_type:
                deg_by_type[dtype] = {"tp": 0, "fn": 0, "total": 0,
                                       "scores": [], "cause_correct": 0}
            result = detector.score(d)
            deg_by_type[dtype]["scores"].append(result["anomaly_score"])
            deg_by_type[dtype]["total"] += 1
            if result["is_anomaly"]:
                deg_by_type[dtype]["tp"] += 1
                all_tp += 1
                cause_ids = [c["cause"] for c in result.get("candidateCauses", [])]
                if dtype in cause_ids:
                    deg_by_type[dtype]["cause_correct"] += 1
            else:
                deg_by_type[dtype]["fn"] += 1

        print(f"\n    {'Degradation':25s} {'Det.Rate':>8s} {'Mean':>6s} {'TP':>4s} {'FN':>4s}")
        print(f"    {'─'*25} {'─'*8} {'─'*6} {'─'*4} {'─'*4}")
        for dtype in sorted(deg_by_type.keys()):
            s = deg_by_type[dtype]
            dr = s["tp"] / max(s["total"], 1)
            print(f"    {dtype:25s} {dr*100:7.1f}% {np.mean(s['scores']):5.3f} "
                  f"{s['tp']:4d} {s['fn']:4d}")

        total_deg = len(deg_test)
        overall_det = all_tp / max(total_deg, 1)
        print(f"\n    Overall detection: {overall_det*100:.1f}%  FPR: {fpr_final*100:.1f}%")

        # Cause classification (SEPARATE metric)
        print(f"\n    CAUSE CLASSIFICATION (given anomaly detected, is cause ID correct?)")
        for dtype in sorted(deg_by_type.keys()):
            s = deg_by_type[dtype]
            if s["tp"] > 0:
                cause_acc = s["cause_correct"] / s["tp"]
                print(f"    {dtype:25s}: {cause_acc*100:.0f}% ({s['cause_correct']}/{s['tp']})")
            else:
                print(f"    {dtype:25s}: N/A (no detections)")

        # Example detections
        print(f"\n  EXAMPLE DETECTIONS")
        shown = 0
        for d in deg_test:
            if shown >= 3:
                break
            result = detector.score(d)
            if result["is_anomaly"]:
                dtype = d.get("degradation_type", "?")
                sev = d.get("severity", 0)
                print(f"\n    [{dtype}] score={result['anomaly_score']:.3f} severity={sev:.2f}")
                print(f"    Evidence:")
                for ev in result["evidence"][:4]:
                    print(f"      {ev['sensor']:22s}: {ev['value']:8.2f} "
                          f"(expected {ev['expected']:8.2f}, {ev['deviation_sigma']:+.1f}σ)")
                if result["candidateCauses"]:
                    print(f"    Candidate causes (synthetic prototype evaluation):")
                    for cc in result["candidateCauses"]:
                        print(f"      {cc['cause']:25s} confidence={cc['confidence']:.2f}")
                shown += 1

        # Save
        model_path = os.path.join(os.path.dirname(__file__), f"anomaly_model_{station}.pkl")
        detector.save(model_path)
        print(f"\n  Model saved: {model_path}")

    print(f"\n{'='*70}")
    print(f"  NOTE: All degradation results are PROTOTYPE EVALUATION")
    print(f"  against synthetic degradation signatures. This does not")
    print(f"  constitute production-readiness validation.")
    print(f"{'='*70}")
