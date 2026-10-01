#!/usr/bin/env python3
"""
Aurora v3 — Baseline Validation Script
Steps through cached ERA5 weather hour-by-hour (not real-time)
and validates the physics model's monotonic/correlated behavior.

Output: correlation checks + baseline_data.json for anomaly training.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from config import BASELINE_DATA_PATH, WEATHER_CACHE_DIR
from physics_model import StationPhysicsModel
from units import cache_wind_unit, wind_factor_to_kmh

TICK_DT = 120  # 2-minute simulated steps


def load_cached_weather(station_id: str) -> list:
    """Load the cached ERA5 JSON and return hourly weather records."""
    cache_dir = str(WEATHER_CACHE_DIR)
    # Find any cached file for this station
    for f in sorted(os.listdir(cache_dir)):
        if f.startswith(station_id) and f.endswith(".json"):
            with open(os.path.join(cache_dir, f)) as fh:
                data = json.load(fh)
            # Build hourly records
            records = []
            times = data["hourly"]["time"]
            temps = data["hourly"]["temperature_2m"]
            # Physics model expects km/h; convert from the cache's recorded unit.
            k = wind_factor_to_kmh(cache_wind_unit(data))
            winds = [None if w is None else w * k for w in data["hourly"]["wind_speed_10m"]]
            pressures = data["hourly"].get("surface_pressure", [None]*len(times))
            humidities = data["hourly"].get("relative_humidity_2m", [None]*len(times))
            for i in range(len(times)):
                records.append({
                    "simulated_time": times[i],
                    "env_temp": temps[i],
                    "env_wind": winds[i],
                    "env_pressure": pressures[i] if pressures[i] is not None else 950,
                    "env_humidity": humidities[i] if humidities[i] is not None else 70,
                })
            print(f"  Loaded {len(records)} hourly records from {f}")
            return records
    raise FileNotFoundError(f"No cached weather for {station_id}")


def validate_station(station_id: str):
    """Run physics model through every hour of cached weather."""
    print(f"\n{'='*60}")
    print(f"  BASELINE VALIDATION — {station_id.upper()}")
    print(f"{'='*60}")

    hourly_weather = load_cached_weather(station_id)
    pm = StationPhysicsModel(station_id)

    output_records = []

    for hour_idx, weather in enumerate(hourly_weather):
        # Run 3 ticks per hour (to let thermal model converge)
        for _ in range(3):
            readings = pm.compute(weather, dt_seconds=TICK_DT)
            meta = readings.pop("_meta", {})

        # Record state after convergence
        pb = meta.get("power_breakdown", {})
        gen_temp = readings.get("generator", {}).get("gen_temp", {})
        gen_temp_val = gen_temp.get("value", 0) if isinstance(gen_temp, dict) else gen_temp
        fuel_rate = readings.get("generator", {}).get("gen_fuel_rate", {})
        fuel_val = fuel_rate.get("value", 0) if isinstance(fuel_rate, dict) else fuel_rate

        output_records.append({
            "hour": hour_idx,
            "sim_time": weather["simulated_time"],
            "env_temp": weather["env_temp"],
            "env_wind": weather["env_wind"],
            "heat_loss": meta.get("total_heat_loss_kW", 0),
            "heat_demand": meta.get("heating_demand_kW", 0),
            "total_demand": pb.get("total_demand_kW", 0),
            "heating_elec": pb.get("heating_electrical_kW", 0),
            "base_elec": pb.get("base_electrical_kW", 0),
            "gen_load": meta.get("gen_load_pct", 0),
            "gen_temp": gen_temp_val,
            "fuel_rate": fuel_val,
        })

    n = len(output_records)
    print(f"  Processed {n} hours of weather data")

    # ── Bounds check ──────────────────────────────────────
    print("\n  BOUNDS CHECK")
    fields = {
        "env_temp":     ("°C",  -80, 10),
        "env_wind":     ("km/h", 0, 250),
        "heat_loss":    ("kW",   0, 200),
        "heat_demand":  ("kW",   0, 250),
        "total_demand": ("kW",  20, 300),
        "gen_load":     ("pct",  5, 100),
        "gen_temp":     ("°C",  20, 120),
        "fuel_rate":    ("L/hr", 5, 60),
    }

    bounds_ok = True
    for field, (unit, lo, hi) in fields.items():
        vals = [r[field] for r in output_records]
        mn, mx = min(vals), max(vals)
        ok = mn >= lo and mx <= hi
        status = "✅" if ok else "❌"
        if not ok:
            bounds_ok = False
        print(f"    {status} {field:15s}: [{mn:7.1f}, {mx:7.1f}] {unit}  (expected [{lo}, {hi}])")

    # ── Correlation check ──────────────────────────────────
    print(f"\n  CORRELATION CHECK (Pearson r over {n} hours)")

    def pearson(xs, ys):
        n = len(xs)
        mx, my = sum(xs)/n, sum(ys)/n
        cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
        sx = max((sum((x - mx)**2 for x in xs))**0.5, 1e-10)
        sy = max((sum((y - my)**2 for y in ys))**0.5, 1e-10)
        return cov / (sx * sy)

    checks = [
        ("env_temp",     "heat_loss",    "negative", -0.3, "Colder → more heat loss"),
        ("env_wind",     "heat_loss",    "positive",  0.3, "Windier → more envelope heat loss"),
        ("heat_loss",    "heat_demand",  "positive",  0.9, "More loss → more heating demand"),
        ("heat_demand",  "total_demand", "positive",  0.3, "Heating → electrical demand"),
        ("total_demand", "gen_load",     "positive",  0.9, "Demand → generator load"),
        ("gen_load",     "fuel_rate",    "positive",  0.3, "Load → fuel consumption"),
    ]

    corr_ok = True
    for x_field, y_field, expected, threshold, desc in checks:
        xs = [r[x_field] for r in output_records]
        ys = [r[y_field] for r in output_records]
        r = pearson(xs, ys)
        if expected == "negative":
            ok = r < threshold
        else:
            ok = r > threshold
        status = "✅" if ok else "❌"
        if not ok:
            corr_ok = False
        print(f"    {status} {desc:45s}  r={r:+.3f}  (threshold {threshold:+.1f})")

    # ── Temperature range statistics ──────────────────────
    print("\n  WEATHER VARIATION")
    temps = [r["env_temp"] for r in output_records]
    winds = [r["env_wind"] for r in output_records]
    print(f"    Temperature range: {min(temps):.1f}°C to {max(temps):.1f}°C  (Δ={max(temps)-min(temps):.1f}°C)")
    print(f"    Wind range:        {min(winds):.1f} to {max(winds):.1f} km/h  (Δ={max(winds)-min(winds):.1f} km/h)")

    # ── Summary statistics ─────────────────────────────────
    print("\n  SUMMARY STATISTICS")
    for field in ["env_temp", "heat_loss", "heat_demand", "total_demand", "gen_load", "gen_temp", "fuel_rate"]:
        vals = [r[field] for r in output_records]
        avg = sum(vals) / len(vals)
        print(f"    {field:15s}: mean={avg:7.1f}  min={min(vals):7.1f}  max={max(vals):7.1f}")

    # ── Sample timestamps ──────────────────────────────────
    print("\n  SAMPLE POINTS (every 24h)")
    for i in range(0, n, 24):
        r = output_records[i]
        print(f"    {r['sim_time'][:16]}  "
              f"T={r['env_temp']:6.1f}°C  W={r['env_wind']:5.1f}km/h  "
              f"loss={r['heat_loss']:5.1f}kW  demand={r['total_demand']:5.1f}kW  "
              f"load={r['gen_load']:4.1f}%  genT={r['gen_temp']:5.1f}°C  fuel={r['fuel_rate']:5.1f}L/hr")

    all_ok = bounds_ok and corr_ok
    print(f"\n  {'✅ ALL CHECKS PASSED' if all_ok else '❌ SOME CHECKS FAILED'}")
    return output_records, all_ok


if __name__ == "__main__":
    maitri_records, maitri_ok = validate_station("maitri")
    bharati_records, bharati_ok = validate_station("bharati")

    print(f"\n{'='*60}")
    print("  FINAL RESULT")
    print(f"{'='*60}")
    print(f"  Maitri:  {'✅ PASS' if maitri_ok else '❌ FAIL'}")
    print(f"  Bharati: {'✅ PASS' if bharati_ok else '❌ FAIL'}")

    # Save baseline data for anomaly training
    baseline = {"maitri": maitri_records, "bharati": bharati_records}
    out_path = str(BASELINE_DATA_PATH)
    with open(out_path, "w") as f:
        json.dump(baseline, f)
    print(f"\n  Baseline saved: {out_path}")
    print(f"  Maitri: {len(maitri_records)} hourly points")
    print(f"  Bharati: {len(bharati_records)} hourly points")
