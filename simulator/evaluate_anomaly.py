#!/usr/bin/env python3
"""
Aurora — anomaly model evaluation (measures only; NEVER writes model files).

Measures, per station, using the exact live tick path (anomaly_engine.replay_states):
  1. False-positive rate on un-injected replay, per cached ERA5 date, over the
     full converged window (thousands of ticks ≫ 30 simulated minutes):
       - "live"  : observed == physics prediction (how simulator.py runs today)
       - "noisy" : observed = prediction + assumed sensor noise (realism check)
  2. Detection rate + time-to-detect for the 4 synthetic degradation types
     (ramped onset, assumed sensor noise on).
  3. Detection rate + time-to-detect for the Demo Control scenarios
     (generator_failure, heating_failure, co2_spike), injected exactly like
     simulator.py does (value += 0.3·(target − value) per tick).

Evaluation uses different physics-noise seeds from training.

Usage:
    python simulator/evaluate_anomaly.py              # evaluate saved .pkl models
    python simulator/evaluate_anomaly.py --json out.json
"""

import ast
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config as app_config
import anomaly_engine as ae

EVAL_SEED_OFFSET = 1000          # physics/noise seeds differ from training
FPR_MAX = 0.02                   # acceptance: FPR < 2 % per station/date
DETECTION_MIN = 0.90             # acceptance: detection ≥ 90 % per scenario/type
DEGRADATION_RUNS = 60            # per type per station
SCENARIO_RUNS = 30               # per scenario per station
PREFILL_TICKS = ae.RATE_LONG_TICKS + 5   # normal ticks before onset (fills rate buffers)
DEMO_SCENARIOS = ("generator_failure", "heating_failure", "co2_spike")
INJECTION_STEP = 0.3             # simulator.py: value = current + (target − current) * 0.3


def demo_scenarios() -> dict:
    """SCENARIOS from simulator.py, read statically (importing it would start the stations)."""
    tree = ast.parse((Path(__file__).resolve().parent / "simulator.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "SCENARIOS" for t in node.targets):
            return ast.literal_eval(node.value)
    raise RuntimeError("SCENARIOS not found in simulator.py")


def sim_tick_interval() -> float:
    tree = ast.parse((Path(__file__).resolve().parent / "simulator.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "TICK_INTERVAL" for t in node.targets):
            return float(ast.literal_eval(node.value))
    raise RuntimeError("TICK_INTERVAL not found in simulator.py")


# ── replay cache ──────────────────────────────────────────────

def converged_states(station: str, date: str, seed: int) -> list:
    """Predicted readings (floats) for every converged tick of one window."""
    conv = ae.ConvergenceTracker(station)
    out = []
    for t, weather, readings, meta, pm in ae.replay_states(station, date, seed=seed):
        if conv.update(pm, meta):
            out.append(ae.observed_from_readings(readings))
    return out


def build_cache(stations=("maitri", "bharati")) -> dict:
    cache = {}
    for i, (station, date) in enumerate(ae.cached_windows(stations)):
        cache[(station, date)] = converged_states(station, date, ae.SEED + EVAL_SEED_OFFSET + i)
    return cache


def _copy(obs):
    return {b: dict(s) for b, s in obs.items()}


def _ttd_summary(ttds, detected, n):
    dt = ae.PHYSICS_TICK_DT_S
    out = {"runs": n, "detected": detected, "detection_rate": detected / n if n else 0.0,
           "ttd_ticks_median": None, "ttd_ticks_p90": None, "ttd_ticks_max": None,
           "ttd_real_s_median": None, "ttd_sim_min_median": None}
    if ttds:
        ticks = np.array(ttds, dtype=float)
        med = float(np.median(ticks))
        out.update(ttd_ticks_median=med, ttd_ticks_p90=float(np.percentile(ticks, 90)),
                   ttd_ticks_max=float(ticks.max()), ttd_real_s_median=med * dt,
                   ttd_sim_min_median=med * dt * ae.TRAIN_SPEED / 60.0)
    return out


# ── 1. false-positive rate ────────────────────────────────────

def fpr_window(det, states, noisy: bool, rng) -> dict:
    fe = ae.FeatureEngine(det.station_id)
    X = []
    for pred in states:
        obs = ae.add_sensor_noise(pred, rng) if noisy else pred
        X.append(ae.features_to_array(fe.extract(obs, pred)))
    X = np.array(X)
    flags = det.flags(X)
    return {"ticks": len(states), "sim_minutes": round(len(states) * ae.PHYSICS_TICK_DT_S * ae.TRAIN_SPEED / 60, 1),
            "false_positives": int(flags.sum()), "fpr": float(flags.mean()),
            "max_score": float(det.scores(X).max()),
            "max_residual_sigma": float(np.abs(X[:, ae._RESIDUAL_IDX]).max())}


# ── 2. synthetic degradations ─────────────────────────────────

def degradation_runs(det, windows, name, n_runs, rng) -> dict:
    fn = ae.DEGRADATIONS[name]
    ttds, detected = [], 0
    for _ in range(n_runs):
        states = windows[rng.integers(len(windows))]
        start = int(rng.integers(PREFILL_TICKS, len(states) - ae.DEGRADATION_WINDOW_TICKS))
        max_sev = float(rng.uniform(0.15, 0.45))
        fe = ae.FeatureEngine(det.station_id)
        for pred in states[start - PREFILL_TICKS:start]:
            fe.extract(ae.add_sensor_noise(pred, rng), pred)
        X = []
        for k in range(ae.DEGRADATION_WINDOW_TICKS):
            pred = states[start + k]
            obs = ae.add_sensor_noise(pred, rng)
            fn(obs, pred, max_sev * min(1.0, (k + 1) / ae.DEGRADATION_RAMP_TICKS), rng)
            X.append(ae.features_to_array(fe.extract(obs, pred)))
        hits = np.nonzero(det.flags(np.array(X)))[0]
        if hits.size:
            detected += 1
            ttds.append(int(hits[0]) + 1)
    return _ttd_summary(ttds, detected, n_runs)


# ── 3. demo-control scenarios (live-exact injection, no added noise) ──

def scenario_runs(det, windows, scenario: dict, n_runs, rng) -> dict:
    duration_ticks = int(scenario["duration"] / sim_tick_interval())
    ttds, detected = [], 0
    for _ in range(n_runs):
        states = windows[rng.integers(len(windows))]
        start = int(rng.integers(PREFILL_TICKS, len(states) - duration_ticks))
        fe = ae.FeatureEngine(det.station_id)
        for pred in states[start - PREFILL_TICKS:start]:
            fe.extract(pred, pred)
        prev = _copy(states[start - 1])
        X = []
        for k in range(duration_ticks):
            pred = states[start + k]
            obs = _copy(pred)
            for key, target in scenario["injections"].items():
                bld, sensor = key.split(".")
                if sensor in obs.get(bld, {}):
                    cur = prev[bld][sensor]
                    obs[bld][sensor] = cur + (target - cur) * INJECTION_STEP
            prev = obs
            X.append(ae.features_to_array(fe.extract(obs, pred)))
        hits = np.nonzero(det.flags(np.array(X)))[0]
        if hits.size:
            detected += 1
            ttds.append(int(hits[0]) + 1)
    out = _ttd_summary(ttds, detected, n_runs)
    out["duration_ticks"] = duration_ticks
    return out


# ── orchestration ─────────────────────────────────────────────

def evaluate(detectors: dict, cache: dict = None) -> dict:
    t0 = time.time()
    cache = cache or build_cache(tuple(detectors))
    scenarios = demo_scenarios()
    metrics = {"fpr": {}, "degradations": {}, "scenarios": {}}
    for station, det in detectors.items():
        rng = np.random.default_rng(ae.SEED + EVAL_SEED_OFFSET + (0 if station == "maitri" else 1))
        windows = [v for (s, _), v in sorted(cache.items()) if s == station]
        metrics["fpr"][station] = {
            date: {"live": fpr_window(det, states, False, rng), "noisy": fpr_window(det, states, True, rng)}
            for (s, date), states in sorted(cache.items()) if s == station
        }
        metrics["degradations"][station] = {
            name: degradation_runs(det, windows, name, DEGRADATION_RUNS, rng) for name in ae.DEGRADATIONS
        }
        metrics["scenarios"][station] = {
            name: scenario_runs(det, windows, scenarios[name], SCENARIO_RUNS, rng) for name in DEMO_SCENARIOS
        }
    metrics["evaluation_seconds"] = round(time.time() - t0, 1)
    return metrics


def criteria_pass(metrics: dict):
    failures = []
    for station, dates in metrics["fpr"].items():
        for date, res in dates.items():
            for mode in ("live", "noisy"):
                if res[mode]["fpr"] >= FPR_MAX:
                    failures.append(f"FPR {station} {date} ({mode}) = {res[mode]['fpr']:.2%} ≥ {FPR_MAX:.0%}")
    for kind in ("degradations", "scenarios"):
        for station, items in metrics[kind].items():
            for name, res in items.items():
                if res["detection_rate"] < DETECTION_MIN:
                    failures.append(f"detection {station} {name} = {res['detection_rate']:.0%} < {DETECTION_MIN:.0%}")
    return (not failures), failures


def format_report(metrics: dict) -> str:
    lines = ["", "## False-positive rate (un-injected replay, full converged window)", "",
             "| Station | Date | Ticks | Sim. minutes | FPR live | FPR noisy | Max IF score | Max \\|z\\| (noisy) |",
             "|---|---|---:|---:|---:|---:|---:|---:|"]
    for station, dates in metrics["fpr"].items():
        for date, r in dates.items():
            lines.append(f"| {station} | {date} | {r['live']['ticks']} | {r['live']['sim_minutes']} | "
                         f"{r['live']['fpr']:.2%} | {r['noisy']['fpr']:.2%} | "
                         f"{max(r['live']['max_score'], r['noisy']['max_score']):.3f} | "
                         f"{r['noisy']['max_residual_sigma']:.1f} |")
    for kind, title in (("degradations", "Synthetic degradations (ramp over 30 ticks, sensor noise on)"),
                        ("scenarios", "Demo Control scenarios (live-exact injection)")):
        lines += ["", f"## {title}", "",
                  "| Station | Scenario | Detected | Rate | TTD median (ticks) | TTD p90 (ticks) | TTD median (real s) | TTD median (sim min) |",
                  "|---|---|---:|---:|---:|---:|---:|---:|"]
        for station, items in metrics[kind].items():
            for name, r in items.items():
                fmt = lambda v: "—" if v is None else f"{v:.0f}"
                lines.append(f"| {station} | {name} | {r['detected']}/{r['runs']} | {r['detection_rate']:.0%} | "
                             f"{fmt(r['ttd_ticks_median'])} | {fmt(r['ttd_ticks_p90'])} | "
                             f"{fmt(r['ttd_real_s_median'])} | {fmt(r['ttd_sim_min_median'])} |")
    lines.append(f"\n_evaluation took {metrics.get('evaluation_seconds')} s_")
    return "\n".join(lines)


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description="Evaluate saved anomaly models (never writes models)")
    ap.add_argument("--json", help="write metrics JSON to this path")
    args = ap.parse_args(argv)
    detectors = {}
    for sid in ("maitri", "bharati"):
        det = ae.AnomalyDetector(sid)
        det.load(str(app_config.anomaly_model_path(sid)))
        detectors[sid] = det
    metrics = evaluate(detectors)
    print(format_report(metrics))
    ok, failures = criteria_pass(metrics)
    print("\nAcceptance:", "PASS" if ok else "FAIL")
    for f in failures:
        print("  -", f)
    if args.json:
        Path(args.json).write_text(json.dumps(metrics, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
