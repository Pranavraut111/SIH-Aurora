#!/usr/bin/env python3
"""
Aurora v3 — Physics Invariant Tests
Tests model behavior by holding one variable constant and varying the other.
These are UNIT TESTS for the physics model, not statistical correlation checks.
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from physics_model import StationPhysicsModel

passed = 0
failed = 0

def test(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name}")
    if detail:
        print(f"      {detail}")


def run_model(station_id, env_temp, env_wind, ticks=10):
    """Run the physics model for several ticks and return the final state."""
    pm = StationPhysicsModel(station_id)
    weather = {"env_temp": env_temp, "env_wind": env_wind, "env_pressure": 950, "env_humidity": 60}
    for _ in range(ticks):
        readings = pm.compute(weather, dt_seconds=120)
        meta = readings.pop("_meta", {})
    return meta, readings, pm


def get_vals(meta, readings):
    pb = meta.get("power_breakdown", {})
    gen_temp = readings.get("generator", {}).get("gen_temp", {})
    gen_temp_val = gen_temp.get("value", 0) if isinstance(gen_temp, dict) else gen_temp
    fuel = readings.get("generator", {}).get("gen_fuel_rate", {})
    fuel_val = fuel.get("value", 0) if isinstance(fuel, dict) else fuel
    return {
        "heat_loss": meta.get("total_heat_loss_kW", 0),
        "heat_demand": meta.get("heating_demand_kW", 0),
        "total_demand": pb.get("total_demand_kW", 0),
        "gen_load": meta.get("gen_load_pct", 0),
        "gen_temp": gen_temp_val,
        "fuel_rate": fuel_val,
    }


print("=" * 60)
print("  PHYSICS INVARIANT TESTS")
print("=" * 60)

# ═══════════════════════════════════════════════════════
#  TEST 1: Temperature monotonicity (hold wind constant)
# ═══════════════════════════════════════════════════════
print("\n  TEST 1: Colder temperature → more heat loss (wind=20 km/h)")
wind = 20
results = {}
for temp in [-10, -20, -30, -40, -50]:
    meta, readings, _ = run_model("maitri", temp, wind, ticks=20)
    v = get_vals(meta, readings)
    results[temp] = v
    print(f"    {temp:+5.0f}°C: loss={v['heat_loss']:5.1f}kW  demand={v['total_demand']:5.1f}kW  load={v['gen_load']:4.1f}%  fuel={v['fuel_rate']:5.1f}L/hr")

test("heat_loss(-20) > heat_loss(-10)", results[-20]["heat_loss"] > results[-10]["heat_loss"])
test("heat_loss(-30) > heat_loss(-20)", results[-30]["heat_loss"] > results[-20]["heat_loss"])
test("heat_loss(-40) > heat_loss(-30)", results[-40]["heat_loss"] > results[-30]["heat_loss"])
test("heat_loss(-50) > heat_loss(-40)", results[-50]["heat_loss"] > results[-40]["heat_loss"])
test("total_demand(-50) > total_demand(-10)",
     results[-50]["total_demand"] > results[-10]["total_demand"],
     f'{results[-50]["total_demand"]:.1f} > {results[-10]["total_demand"]:.1f}')

# ═══════════════════════════════════════════════════════
#  TEST 2: Wind monotonicity (hold temperature constant)
# ═══════════════════════════════════════════════════════
print("\n  TEST 2: Higher wind → more heat loss (temp=-25°C)")
temp = -25
results = {}
for wind in [5, 20, 40, 60, 80]:
    meta, readings, _ = run_model("maitri", temp, wind, ticks=20)
    v = get_vals(meta, readings)
    results[wind] = v
    print(f"    {wind:3.0f} km/h: loss={v['heat_loss']:5.1f}kW  demand={v['total_demand']:5.1f}kW")

test("heat_loss(20) > heat_loss(5)", results[20]["heat_loss"] > results[5]["heat_loss"])
test("heat_loss(40) > heat_loss(20)", results[40]["heat_loss"] > results[20]["heat_loss"])
test("heat_loss(60) > heat_loss(40)", results[60]["heat_loss"] > results[40]["heat_loss"])
test("heat_loss(80) > heat_loss(60)", results[80]["heat_loss"] > results[60]["heat_loss"])

# ═══════════════════════════════════════════════════════
#  TEST 3: Generator load → fuel monotonicity
# ═══════════════════════════════════════════════════════
print("\n  TEST 3: Higher load → more fuel (vary temp at wind=20)")
results = {}
for temp in [-5, -15, -25, -35, -45]:
    meta, readings, _ = run_model("maitri", temp, 20, ticks=20)
    v = get_vals(meta, readings)
    results[temp] = v
    print(f"    {temp:+5.0f}°C: load={v['gen_load']:4.1f}%  fuel={v['fuel_rate']:5.1f}L/hr  genT={v['gen_temp']:5.1f}°C")

test("fuel(-25) > fuel(-5)", results[-25]["fuel_rate"] > results[-5]["fuel_rate"])
test("fuel(-45) > fuel(-25)", results[-45]["fuel_rate"] > results[-25]["fuel_rate"])
test("fuel(-45) > fuel(-15)", results[-45]["fuel_rate"] > results[-15]["fuel_rate"])

# ═══════════════════════════════════════════════════════
#  TEST 3b: Isolated generator test — constant weather,
#  direct Willans line + thermal equations
# ═══════════════════════════════════════════════════════
print("\n  TEST 3b: Isolated load → fuel and load → gen_temp")
print("          (T=-25°C, W=20km/h, equations tested directly)")

pm_iso = StationPhysicsModel("maitri")
g = pm_iso.params["generator"]
print(f"    Willans line: fuel = {g['fuel_coeff_a']} + {g['fuel_coeff_b']} × demand")
print(f"    Gen temp:     base({g['coolant_base_temp_C']}°C) + load × {g['temp_rise_per_load']}°C / {g['cooling_efficiency']}")

iso_results = {}
for load_pct in [20, 30, 40, 50, 60, 80]:
    demand = g["max_power_kW"] * (load_pct / 100)
    fuel = g["fuel_coeff_a"] + g["fuel_coeff_b"] * demand
    load_factor = load_pct / 100
    gen_temp = g["coolant_base_temp_C"] + load_factor * g["temp_rise_per_load"] / g["cooling_efficiency"]
    iso_results[load_pct] = {"fuel": fuel, "gen_temp": gen_temp, "demand": demand}
    print(f"    {load_pct:3d}% load ({demand:5.0f}kW): fuel={fuel:5.1f}L/hr  genT={gen_temp:5.1f}°C")

test("fuel(30%) > fuel(20%)", iso_results[30]["fuel"] > iso_results[20]["fuel"])
test("fuel(50%) > fuel(40%)", iso_results[50]["fuel"] > iso_results[40]["fuel"])
test("fuel(80%) > fuel(60%)", iso_results[80]["fuel"] > iso_results[60]["fuel"])
test("genT(30%) > genT(20%)", iso_results[30]["gen_temp"] > iso_results[20]["gen_temp"])
test("genT(50%) > genT(40%)", iso_results[50]["gen_temp"] > iso_results[40]["gen_temp"])
test("genT(80%) > genT(60%)", iso_results[80]["gen_temp"] > iso_results[60]["gen_temp"])

# ═══════════════════════════════════════════════════════
#  TEST 4: Station independence
# ═══════════════════════════════════════════════════════
print("\n  TEST 4: Maitri and Bharati produce independent results")
meta_m, _, pm_m = run_model("maitri", -20, 30, ticks=20)
meta_b, _, pm_b = run_model("bharati", -20, 30, ticks=20)
vm = get_vals(meta_m, _)
# re-run bharati to get readings
meta_b2, readings_b2, _ = run_model("bharati", -20, 30, ticks=20)
vb = get_vals(meta_b2, readings_b2)

test("Different heat loss (diff U-values/areas)",
     abs(vm["heat_loss"] - vb["heat_loss"]) > 0.1,
     f'Maitri={vm["heat_loss"]:.1f}kW vs Bharati={vb["heat_loss"]:.1f}kW')
test("Different gen capacity",
     pm_m.params["generator"]["max_power_kW"] != pm_b.params["generator"]["max_power_kW"],
     f'Maitri={pm_m.params["generator"]["max_power_kW"]}kW vs Bharati={pm_b.params["generator"]["max_power_kW"]}kW')

# ═══════════════════════════════════════════════════════
#  TEST 5: Bounds — no negative heat loss, no impossible temps
# ═══════════════════════════════════════════════════════
print("\n  TEST 5: Physical bounds")
for temp in [-60, -40, -20, 0, 5]:
    meta, readings, pm = run_model("maitri", temp, 40, ticks=20)
    v = get_vals(meta, readings)
    test(f"heat_loss >= 0 at {temp}°C", v["heat_loss"] >= 0, f'{v["heat_loss"]:.2f}')
    test(f"gen_temp in [20,120] at {temp}°C", 20 <= v["gen_temp"] <= 120, f'{v["gen_temp"]:.1f}°C')
    test(f"indoor near target at {temp}°C",
         all(abs(pm.indoor_temps[b] - pm.params["buildings"][b]["target_temp_C"]) <= 4
             for b in pm.indoor_temps),
         f'{dict((k, round(v, 1)) for k, v in pm.indoor_temps.items())}')

# ═══════════════════════════════════════════════════════
print(f"\n{'='*60}")
print(f"  RESULTS: {passed} passed, {failed} failed")
print(f"  {'✅ ALL INVARIANTS HOLD' if failed == 0 else '❌ SOME INVARIANTS VIOLATED'}")
print(f"{'='*60}")
