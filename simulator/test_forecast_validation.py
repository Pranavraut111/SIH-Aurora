#!/usr/bin/env python3
"""
Aurora v3 — Phase 4 Forecast Validation

Walk-forward evaluation using ERA5 reanalysis data.

Methodology:
    1. Download ERA5 for a 7-day evaluation period
    2. Run the physics model tick-by-tick through the period (ground truth)
    3. At each evaluation point, make a "forecast" by running
       the physics model forward with future ERA5 weather
    4. Compare forecast vs ground-truth at 1h, 6h, 12h, 24h horizons
    5. Report MAE, RMSE, bias for weather and physics-derived variables

This validates that the physics forward-run is self-consistent,
separate from weather forecast accuracy (which depends on GFS/ICON skill).
"""

import sys, os, json, math, time
import numpy as np
from datetime import datetime, timedelta
from copy import deepcopy

sys.path.insert(0, os.path.dirname(__file__))
from weather_data import WeatherDataLayer
from physics_model import StationPhysicsModel

# ── Evaluation configuration ──────────────────────────────
# Use a winter period for challenging conditions
EVAL_DATE = "2024-07-15"  # Antarctic winter
EVAL_DAYS = 7
TICK_DT = 600  # 10-minute ticks for ground truth
HORIZONS_HOURS = [1, 6, 12, 24]


def fetch_eval_data(station_id: str) -> dict:
    """Fetch ERA5 data for the evaluation period."""
    wl = WeatherDataLayer(station_id, date=EVAL_DATE, speed_factor=1)
    success = wl.fetch_and_cache()
    if not success:
        print(f"  [{station_id}] ✗ Failed to fetch ERA5 for {EVAL_DATE}")
        return None
    return wl.data


def interpolate_weather(data: dict, hour_index: float) -> dict:
    """Interpolate ERA5 data at a fractional hour index."""
    idx_lo = int(hour_index)
    idx_hi = min(idx_lo + 1, len(data["time"]) - 1)
    frac = hour_index - idx_lo

    def interp(key):
        vals = data.get(key, [])
        if idx_lo >= len(vals):
            return None
        lo = vals[idx_lo]
        hi = vals[idx_hi] if idx_hi < len(vals) else lo
        if lo is None or hi is None:
            return lo or hi
        return lo + (hi - lo) * frac

    return {
        "env_temp": interp("temperature_2m"),
        "env_wind": interp("wind_speed_10m"),
        "env_pressure": interp("surface_pressure"),
        "env_humidity": interp("relative_humidity_2m"),
    }


def run_ground_truth(station_id: str, data: dict) -> list:
    """Run physics model through the entire ERA5 period at 10-min ticks.

    Returns list of {hour_index, weather, state} at each tick.
    """
    pm = StationPhysicsModel(station_id)
    total_hours = len(data["time"]) - 1
    ticks_per_hour = 3600 / TICK_DT  # 6 ticks per hour at 600s

    trajectory = []
    hour = 0.0

    while hour <= total_hours:
        weather = interpolate_weather(data, hour)
        if weather["env_temp"] is None:
            hour += TICK_DT / 3600
            continue

        readings = pm.compute(weather, dt_seconds=TICK_DT)
        meta = readings.pop("_meta", {})

        gen = readings.get("generator", {})
        gt = gen.get("gen_temp", {})
        gt_val = gt.get("value", 0) if isinstance(gt, dict) else (gt or 0)
        fr = gen.get("gen_fuel_rate", {})
        fr_val = fr.get("value", 0) if isinstance(fr, dict) else (fr or 0)

        state = {
            "hour_index": round(hour, 2),
            "env_temp": weather["env_temp"],
            "env_wind": weather.get("env_wind", 0),
            "gen_load_pct": meta.get("gen_load_pct", 0),
            "gen_temp_C": gt_val,
            "fuel_rate_Lhr": fr_val,
            "heating_demand_kW": meta.get("heating_demand_kW", 0),
            "total_demand_kW": meta.get("power_breakdown", {}).get("total_demand_kW", 0),
        }
        trajectory.append(state)

        # Save physics model state at whole-hour marks for forecasting
        if abs(hour - round(hour)) < 0.01:
            state["_pm_snapshot"] = {
                "fuel_kL": pm.fuel_kL,
                "food_days": pm.food_days,
                "spares": pm.spares,
                "water_level_pct": pm.water_level_pct,
                "gen_temp_C": pm.gen_temp_C,
                "gen_rpm": pm.gen_rpm,
                "indoor_temps": dict(pm.indoor_temps),
            }

        hour += TICK_DT / 3600

    return trajectory


def make_forecast(station_id: str, data: dict, snapshot: dict,
                  start_hour: float, horizon_hours: float) -> dict:
    """From a saved physics state, run forward with ERA5 weather."""
    pm = StationPhysicsModel(station_id)
    # Restore state
    pm.fuel_kL = snapshot["fuel_kL"]
    pm.food_days = snapshot["food_days"]
    pm.spares = snapshot["spares"]
    pm.water_level_pct = snapshot["water_level_pct"]
    pm.gen_temp_C = snapshot["gen_temp_C"]
    pm.gen_rpm = snapshot["gen_rpm"]
    pm.indoor_temps = dict(snapshot["indoor_temps"])

    target_hour = start_hour + horizon_hours
    total_hours = len(data["time"]) - 1
    if target_hour > total_hours:
        return None

    # Run forward in 10-min steps
    n_steps = max(1, int(horizon_hours * 3600 / TICK_DT))
    for i in range(n_steps):
        h = start_hour + (i + 1) * (horizon_hours / n_steps)
        h = min(h, total_hours)
        weather = interpolate_weather(data, h)
        if weather["env_temp"] is None:
            continue
        readings = pm.compute(weather, dt_seconds=TICK_DT)
        meta = readings.pop("_meta", {})

    gen = readings.get("generator", {})
    gt = gen.get("gen_temp", {})
    gt_val = gt.get("value", 0) if isinstance(gt, dict) else (gt or 0)
    fr = gen.get("gen_fuel_rate", {})
    fr_val = fr.get("value", 0) if isinstance(fr, dict) else (fr or 0)

    return {
        "gen_load_pct": meta.get("gen_load_pct", 0),
        "gen_temp_C": gt_val,
        "fuel_rate_Lhr": fr_val,
        "heating_demand_kW": meta.get("heating_demand_kW", 0),
        "total_demand_kW": meta.get("power_breakdown", {}).get("total_demand_kW", 0),
    }


def find_nearest(trajectory: list, target_hour: float) -> dict:
    """Find the trajectory entry closest to a target hour."""
    best = None
    best_diff = float("inf")
    for s in trajectory:
        diff = abs(s["hour_index"] - target_hour)
        if diff < best_diff:
            best_diff = diff
            best = s
    return best


# ═══════════════════════════════════════════════════════
#  Main evaluation
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    results = {}

    for station in ["maitri", "bharati"]:
        print(f"\n{'='*70}")
        print(f"  FORECAST VALIDATION — {station.upper()}")
        print(f"  Evaluation period: {EVAL_DATE}, {EVAL_DAYS} days")
        print(f"{'='*70}")

        # Fetch ERA5
        data = fetch_eval_data(station)
        if data is None:
            continue

        n_hours = len(data["time"])
        print(f"  ERA5 data: {n_hours} hourly points")

        # Run ground truth
        print(f"\n  Running ground truth ({TICK_DT}s ticks)...")
        trajectory = run_ground_truth(station, data)
        print(f"  Ground truth: {len(trajectory)} states computed")

        # Walk-forward evaluation
        print(f"\n  WALK-FORWARD EVALUATION")
        print(f"  Making forecasts every 6 hours, evaluating at {HORIZONS_HOURS}h horizons")

        errors = {h: {"gen_load": [], "gen_temp": [], "fuel": [],
                       "heating": [], "demand": [], "weather_temp": []}
                  for h in HORIZONS_HOURS}

        eval_points = 0
        # Evaluate every 6 hours
        for start_h in range(0, n_hours - 25, 6):
            # Find the ground-truth state at this hour
            gt_start = find_nearest(trajectory, start_h)
            if gt_start is None or "_pm_snapshot" not in gt_start:
                continue

            snapshot = gt_start["_pm_snapshot"]

            for horizon in HORIZONS_HOURS:
                target_h = start_h + horizon
                if target_h >= n_hours:
                    continue

                # Make forecast
                pred = make_forecast(station, data, snapshot, start_h, horizon)
                if pred is None:
                    continue

                # Find ground truth at target
                gt_target = find_nearest(trajectory, target_h)
                if gt_target is None:
                    continue

                # Weather (ERA5 vs ERA5 = 0 error, but validates pipeline)
                weather_pred = interpolate_weather(data, target_h)
                weather_gt = gt_target.get("env_temp", 0)
                if weather_pred and weather_pred["env_temp"] is not None:
                    errors[horizon]["weather_temp"].append(
                        weather_pred["env_temp"] - weather_gt)

                # Physics predictions vs ground truth
                errors[horizon]["gen_load"].append(
                    pred["gen_load_pct"] - gt_target["gen_load_pct"])
                errors[horizon]["gen_temp"].append(
                    pred["gen_temp_C"] - gt_target["gen_temp_C"])
                errors[horizon]["fuel"].append(
                    pred["fuel_rate_Lhr"] - gt_target["fuel_rate_Lhr"])
                errors[horizon]["heating"].append(
                    pred["heating_demand_kW"] - gt_target["heating_demand_kW"])
                errors[horizon]["demand"].append(
                    pred["total_demand_kW"] - gt_target["total_demand_kW"])

            eval_points += 1

        print(f"  Evaluation points: {eval_points}")

        # ── Report: Weather (ERA5 pipeline check) ────────────
        print(f"\n  WEATHER PIPELINE CHECK (ERA5 vs ERA5 — should be ~0)")
        print(f"    {'Horizon':>8s} {'MAE':>8s} {'RMSE':>8s} {'Bias':>8s} {'N':>5s}")
        print(f"    {'─'*8} {'─'*8} {'─'*8} {'─'*8} {'─'*5}")
        for h in HORIZONS_HOURS:
            e = np.array(errors[h]["weather_temp"])
            if len(e) == 0:
                continue
            mae = np.mean(np.abs(e))
            rmse = np.sqrt(np.mean(e**2))
            bias = np.mean(e)
            print(f"    {h:>6d}h {mae:>7.2f}°C {rmse:>7.2f}°C {bias:>+7.2f}°C {len(e):>5d}")

        # ── Report: Physics forward prediction ────────────────
        print(f"\n  PHYSICS FORWARD PREDICTION ACCURACY")
        print(f"  (Physics model run forward vs tick-by-tick ground truth)")

        variables = [
            ("gen_load", "Gen Load", "%"),
            ("gen_temp", "Gen Temp", "°C"),
            ("fuel", "Fuel Rate", "L/hr"),
            ("heating", "Heating", "kW"),
            ("demand", "Total Demand", "kW"),
        ]

        for var_key, var_name, unit in variables:
            print(f"\n    {var_name} ({unit})")
            print(f"    {'Horizon':>8s} {'MAE':>10s} {'RMSE':>10s} {'Bias':>10s} {'N':>5s}")
            print(f"    {'─'*8} {'─'*10} {'─'*10} {'─'*10} {'─'*5}")
            for h in HORIZONS_HOURS:
                e = np.array(errors[h][var_key])
                if len(e) == 0:
                    continue
                mae = np.mean(np.abs(e))
                rmse = np.sqrt(np.mean(e**2))
                bias = np.mean(e)
                print(f"    {h:>6d}h {mae:>9.2f}{unit} {rmse:>9.2f}{unit} "
                      f"{bias:>+9.2f}{unit} {len(e):>5d}")

        # Store for summary
        results[station] = errors

    # ── Summary across both stations ─────────────────────
    print(f"\n{'='*70}")
    print(f"  SUMMARY — PHYSICS FORECAST VALIDATION")
    print(f"  Evaluation: {EVAL_DATE}, {EVAL_DAYS} days, both stations")
    print(f"  Method: Walk-forward, forecast every 6h, ERA5 weather")
    print(f"  Ground truth: Tick-by-tick physics model ({TICK_DT}s steps)")
    print(f"{'='*70}")

    print(f"\n  Generator Temperature MAE (most important metric)")
    print(f"  {'Horizon':>8s} {'Maitri':>10s} {'Bharati':>10s}")
    print(f"  {'─'*8} {'─'*10} {'─'*10}")
    for h in HORIZONS_HOURS:
        vals = []
        for station in ["maitri", "bharati"]:
            if station in results:
                e = np.array(results[station][h]["gen_temp"])
                vals.append(f"{np.mean(np.abs(e)):>9.2f}°C" if len(e) > 0 else "      N/A")
            else:
                vals.append("      N/A")
        print(f"  {h:>6d}h {vals[0]} {vals[1]}")

    print(f"\n  Generator Load MAE")
    print(f"  {'Horizon':>8s} {'Maitri':>10s} {'Bharati':>10s}")
    print(f"  {'─'*8} {'─'*10} {'─'*10}")
    for h in HORIZONS_HOURS:
        vals = []
        for station in ["maitri", "bharati"]:
            if station in results:
                e = np.array(results[station][h]["gen_load"])
                vals.append(f"{np.mean(np.abs(e)):>8.2f}%" if len(e) > 0 else "     N/A")
            else:
                vals.append("     N/A")
        print(f"  {h:>6d}h {vals[0]} {vals[1]}")

    print(f"\n  NOTE: These errors measure the physics model's forward-prediction")
    print(f"  consistency using perfect (ERA5) weather. Real forecast errors")
    print(f"  would include additional weather forecast uncertainty from GFS/ICON.")
    print(f"\n  Weather forecast accuracy depends on Open-Meteo GFS/ICON skill,")
    print(f"  which is externally validated and not under Aurora's control.")
