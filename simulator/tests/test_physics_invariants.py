"""Physics invariant tests — hold one driver constant and vary the other.

Converted from the old `simulator/test_physics_invariants.py` print-script: the same 35
checks, now as real assertions. These are unit tests of `StationPhysicsModel`, not
statistical correlation checks, so they need no DB, no network and no model artefacts.
"""

import pytest

from physics_model import StationPhysicsModel

TICKS = 20
BASE_WEATHER = {"env_pressure": 950, "env_humidity": 60}


def _scalar(reading):
    """Readings are either {"value": x, "unit": u} or a bare number."""
    return reading.get("value", 0) if isinstance(reading, dict) else (reading or 0)


def _run(station_id, env_temp, env_wind, ticks=TICKS):
    """Run the model for `ticks` steps; return (metrics, model)."""
    pm = StationPhysicsModel(station_id)
    weather = {**BASE_WEATHER, "env_temp": env_temp, "env_wind": env_wind}
    meta, readings = {}, {}
    for _ in range(ticks):
        readings = pm.compute(weather, dt_seconds=120)
        meta = readings.pop("_meta", {})
    gen = readings.get("generator", {})
    metrics = {
        "heat_loss": meta.get("total_heat_loss_kW", 0),
        "heat_demand": meta.get("heating_demand_kW", 0),
        "total_demand": meta.get("power_breakdown", {}).get("total_demand_kW", 0),
        "gen_load": meta.get("gen_load_pct", 0),
        "gen_temp": _scalar(gen.get("gen_temp")),
        "fuel_rate": _scalar(gen.get("gen_fuel_rate")),
    }
    return metrics, pm


@pytest.fixture(scope="module")
def by_temp():
    """Maitri at wind=20 km/h, swept over temperature."""
    return {t: _run("maitri", t, 20)[0] for t in (-50, -45, -40, -35, -30, -25, -20, -15, -10, -5)}


@pytest.fixture(scope="module")
def by_wind():
    """Maitri at -25 °C, swept over wind speed."""
    return {w: _run("maitri", -25, w)[0] for w in (5, 20, 40, 60, 80)}


# ── 1. Colder outside → more heat loss (wind held at 20 km/h) ────────────────
@pytest.mark.parametrize(("colder", "warmer"), [(-20, -10), (-30, -20), (-40, -30), (-50, -40)])
def test_colder_means_more_heat_loss(by_temp, colder, warmer):
    assert by_temp[colder]["heat_loss"] > by_temp[warmer]["heat_loss"], (
        f"{colder}°C: {by_temp[colder]['heat_loss']:.1f} kW "
        f"is not > {warmer}°C: {by_temp[warmer]['heat_loss']:.1f} kW"
    )


def test_colder_means_more_total_demand(by_temp):
    assert by_temp[-50]["total_demand"] > by_temp[-10]["total_demand"], (
        f"{by_temp[-50]['total_demand']:.1f} kW is not > {by_temp[-10]['total_demand']:.1f} kW"
    )


# ── 2. More wind → more heat loss (temperature held at -25 °C) ───────────────
@pytest.mark.parametrize(("windier", "calmer"), [(20, 5), (40, 20), (60, 40), (80, 60)])
def test_more_wind_means_more_heat_loss(by_wind, windier, calmer):
    assert by_wind[windier]["heat_loss"] > by_wind[calmer]["heat_loss"], (
        f"{windier} km/h: {by_wind[windier]['heat_loss']:.1f} kW "
        f"is not > {calmer} km/h: {by_wind[calmer]['heat_loss']:.1f} kW"
    )


# ── 3. Higher generator load → more fuel burnt (driven by temperature) ───────
@pytest.mark.parametrize(("colder", "warmer"), [(-25, -5), (-45, -25), (-45, -15)])
def test_colder_means_more_fuel(by_temp, colder, warmer):
    assert by_temp[colder]["fuel_rate"] > by_temp[warmer]["fuel_rate"], (
        f"{colder}°C: {by_temp[colder]['fuel_rate']:.1f} L/hr "
        f"is not > {warmer}°C: {by_temp[warmer]['fuel_rate']:.1f} L/hr"
    )


# ── 3b. The generator equations themselves (Willans line + coolant thermal) ──
def _generator_curve():
    g = StationPhysicsModel("maitri").params["generator"]
    out = {}
    for load_pct in (20, 30, 40, 50, 60, 80):
        demand = g["max_power_kW"] * (load_pct / 100)
        out[load_pct] = {
            "fuel": g["fuel_coeff_a"] + g["fuel_coeff_b"] * demand,
            "gen_temp": g["coolant_base_temp_C"]
            + (load_pct / 100) * g["temp_rise_per_load"] / g["cooling_efficiency"],
        }
    return out


@pytest.mark.parametrize(("hi", "lo"), [(30, 20), (50, 40), (80, 60)])
def test_willans_line_is_monotonic_in_load(hi, lo):
    curve = _generator_curve()
    assert curve[hi]["fuel"] > curve[lo]["fuel"]


@pytest.mark.parametrize(("hi", "lo"), [(30, 20), (50, 40), (80, 60)])
def test_coolant_temperature_rises_with_load(hi, lo):
    curve = _generator_curve()
    assert curve[hi]["gen_temp"] > curve[lo]["gen_temp"]


# ── 4. The two stations are modelled independently ──────────────────────────
def test_stations_have_different_heat_loss():
    """Different U-values and envelope areas must produce different losses."""
    maitri, _ = _run("maitri", -20, 30)
    bharati, _ = _run("bharati", -20, 30)
    assert abs(maitri["heat_loss"] - bharati["heat_loss"]) > 0.1, (
        f"maitri={maitri['heat_loss']:.1f} kW vs bharati={bharati['heat_loss']:.1f} kW"
    )


def test_stations_have_different_generator_capacity():
    maitri = StationPhysicsModel("maitri").params["generator"]["max_power_kW"]
    bharati = StationPhysicsModel("bharati").params["generator"]["max_power_kW"]
    assert maitri != bharati, f"both stations report {maitri} kW"


# ── 5. Physical bounds hold across the whole temperature range ──────────────
BOUND_TEMPS = (-60, -40, -20, 0, 5)


@pytest.fixture(scope="module")
def bounds():
    return {t: _run("maitri", t, 40) for t in BOUND_TEMPS}


@pytest.mark.parametrize("temp", BOUND_TEMPS)
def test_heat_loss_is_never_negative(bounds, temp):
    metrics, _ = bounds[temp]
    assert metrics["heat_loss"] >= 0, f"{metrics['heat_loss']:.2f} kW at {temp}°C"


@pytest.mark.parametrize("temp", BOUND_TEMPS)
def test_generator_temperature_stays_plausible(bounds, temp):
    metrics, _ = bounds[temp]
    assert 20 <= metrics["gen_temp"] <= 120, f"{metrics['gen_temp']:.1f}°C at {temp}°C outside"


@pytest.mark.parametrize("temp", BOUND_TEMPS)
def test_indoor_temperature_tracks_its_target(bounds, temp):
    _, pm = bounds[temp]
    off_target = {
        b: round(pm.indoor_temps[b] - pm.params["buildings"][b]["target_temp_C"], 1)
        for b in pm.indoor_temps
        if abs(pm.indoor_temps[b] - pm.params["buildings"][b]["target_temp_C"]) > 4
    }
    assert not off_target, f"at {temp}°C these buildings drifted >4 °C from target: {off_target}"
