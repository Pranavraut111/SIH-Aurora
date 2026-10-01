"""Walk-forward validation of the physics forward-run (marked `slow`).

Converted from the old `simulator/test_forecast_validation.py` print-script. The method is
unchanged: replay a week of ERA5 reanalysis tick-by-tick as ground truth, then at every
6-hour mark restore the saved physics state and run it forward to the 1/6/12/24-hour
horizons. What this measures is the model's *self-consistency* under perfect weather —
not real forecast skill, which also carries GFS/ICON weather error.

Offline by design: it reads the committed ERA5 caches in `simulator/weather_cache/`
(`<station>_2024-07-15_2024-07-22.json`) and is skipped if they are missing.

Run with:  pytest -m slow
"""

import statistics

import pytest

from physics_model import StationPhysicsModel
from weather_data import WeatherDataLayer

pytestmark = pytest.mark.slow

EVAL_DATE = "2024-07-15"      # Antarctic winter — the demanding end of the range
TICK_DT = 600                 # 10-minute ticks for the ground-truth run
HORIZONS_HOURS = (1, 6, 12, 24)
STATIONS = ("maitri", "bharati")

# Tolerances are ~3x the errors observed on the committed caches, so this test catches a
# real regression in the forward-run without being a brittle snapshot of exact numbers.
MAX_MAE = {
    "gen_temp_C": 3.0,          # °C
    "gen_load_pct": 5.0,        # %
    "fuel_rate_Lhr": 5.0,       # L/hr
    "heating_demand_kW": 2.0,   # kW
    "total_demand_kW": 8.0,     # kW
}
TRACKED = tuple(MAX_MAE)


def _scalar(reading):
    return reading.get("value", 0) if isinstance(reading, dict) else (reading or 0)


def _era5(station_id):
    """Load the cached ERA5 week, with wind converted to the physics model's km/h."""
    wl = WeatherDataLayer(station_id, date=EVAL_DATE, speed_factor=1)
    if not wl.fetch_and_cache():
        pytest.skip(f"no committed ERA5 cache for {station_id} {EVAL_DATE} (and the network is off)")
    factor = wl.wind_to_kmh
    return {
        **wl.data,
        "wind_speed_10m": [None if v is None else v * factor for v in wl.data.get("wind_speed_10m", [])],
    }


def _weather_at(data, hour_index):
    """Linearly interpolate the hourly ERA5 series at a fractional hour index."""
    lo = int(hour_index)
    hi = min(lo + 1, len(data["time"]) - 1)
    frac = hour_index - lo

    def interp(key):
        vals = data.get(key, [])
        if lo >= len(vals):
            return None
        a = vals[lo]
        b = vals[hi] if hi < len(vals) else a
        if a is None or b is None:
            return a if a is not None else b
        return a + (b - a) * frac

    return {
        "env_temp": interp("temperature_2m"),
        "env_wind": interp("wind_speed_10m"),
        "env_pressure": interp("surface_pressure"),
        "env_humidity": interp("relative_humidity_2m"),
    }


def _state(meta, readings, hour, weather):
    gen = readings.get("generator", {})
    return {
        "hour_index": round(hour, 2),
        "env_temp": weather["env_temp"],
        "gen_load_pct": meta.get("gen_load_pct", 0),
        "gen_temp_C": _scalar(gen.get("gen_temp")),
        "fuel_rate_Lhr": _scalar(gen.get("gen_fuel_rate")),
        "heating_demand_kW": meta.get("heating_demand_kW", 0),
        "total_demand_kW": meta.get("power_breakdown", {}).get("total_demand_kW", 0),
    }


def _snapshot(pm):
    return {
        "fuel_kL": pm.fuel_kL,
        "food_days": pm.food_days,
        "spares": pm.spares,
        "water_level_pct": pm.water_level_pct,
        "gen_temp_C": pm.gen_temp_C,
        "gen_rpm": pm.gen_rpm,
        "indoor_temps": dict(pm.indoor_temps),
    }


def _restore(pm, snap):
    pm.fuel_kL = snap["fuel_kL"]
    pm.food_days = snap["food_days"]
    pm.spares = snap["spares"]
    pm.water_level_pct = snap["water_level_pct"]
    pm.gen_temp_C = snap["gen_temp_C"]
    pm.gen_rpm = snap["gen_rpm"]
    pm.indoor_temps = dict(snap["indoor_temps"])


def _ground_truth(station_id, data):
    """Tick the model through the whole ERA5 week; snapshot its state on each whole hour."""
    pm = StationPhysicsModel(station_id)
    total_hours = len(data["time"]) - 1
    trajectory, hour = [], 0.0
    while hour <= total_hours:
        weather = _weather_at(data, hour)
        if weather["env_temp"] is None:
            hour += TICK_DT / 3600
            continue
        readings = pm.compute(weather, dt_seconds=TICK_DT)
        state = _state(readings.pop("_meta", {}), readings, hour, weather)
        if abs(hour - round(hour)) < 0.01:
            state["_pm_snapshot"] = _snapshot(pm)
        trajectory.append(state)
        hour += TICK_DT / 3600
    return trajectory


def _forecast(station_id, data, snapshot, start_hour, horizon_hours):
    """Restore a saved physics state and run it forward with (perfect) ERA5 weather."""
    total_hours = len(data["time"]) - 1
    if start_hour + horizon_hours > total_hours:
        return None
    pm = StationPhysicsModel(station_id)
    _restore(pm, snapshot)
    n_steps = max(1, int(horizon_hours * 3600 / TICK_DT))
    meta, readings = {}, {}
    for i in range(n_steps):
        h = min(start_hour + (i + 1) * (horizon_hours / n_steps), total_hours)
        weather = _weather_at(data, h)
        if weather["env_temp"] is None:
            continue
        readings = pm.compute(weather, dt_seconds=TICK_DT)
        meta = readings.pop("_meta", {})
    if not readings:
        return None
    return _state(meta, readings, start_hour + horizon_hours, weather)


def _nearest(trajectory, target_hour):
    return min(trajectory, key=lambda s: abs(s["hour_index"] - target_hour))


def _walk_forward(station_id):
    """errors[horizon][variable] -> list of (forecast - ground truth)."""
    data = _era5(station_id)
    n_hours = len(data["time"])
    trajectory = _ground_truth(station_id, data)
    errors = {h: {v: [] for v in (*TRACKED, "weather_temp")} for h in HORIZONS_HOURS}

    for start_h in range(0, n_hours - 25, 6):
        start = _nearest(trajectory, start_h)
        if "_pm_snapshot" not in start:
            continue
        for horizon in HORIZONS_HOURS:
            target_h = start_h + horizon
            if target_h >= n_hours:
                continue
            pred = _forecast(station_id, data, start["_pm_snapshot"], start_h, horizon)
            if pred is None:
                continue
            truth = _nearest(trajectory, target_h)
            for var in TRACKED:
                errors[horizon][var].append(pred[var] - truth[var])
            weather = _weather_at(data, target_h)
            if weather["env_temp"] is not None:
                errors[horizon]["weather_temp"].append(weather["env_temp"] - truth_temp(trajectory, target_h))
    return errors


def truth_temp(trajectory, target_hour):
    """The ERA5 temperature the ground-truth run actually saw at `target_hour`."""
    return _nearest(trajectory, target_hour).get("env_temp", 0)


def _mae(values):
    return statistics.fmean(abs(v) for v in values)


@pytest.fixture(scope="module", params=STATIONS)
def walk_forward(request):
    return request.param, _walk_forward(request.param)


def test_every_horizon_was_actually_evaluated(walk_forward):
    station, errors = walk_forward
    for horizon in HORIZONS_HOURS:
        n = len(errors[horizon]["gen_temp_C"])
        assert n >= 20, f"{station} {horizon}h: only {n} evaluation points"


@pytest.mark.parametrize("variable", TRACKED)
def test_forward_run_stays_within_tolerance(walk_forward, variable, record_property):
    """MAE at every horizon must stay inside MAX_MAE (reported via the junit properties)."""
    station, errors = walk_forward
    for horizon in HORIZONS_HOURS:
        mae = _mae(errors[horizon][variable])
        record_property(f"{station}.{variable}.{horizon}h.mae", round(mae, 3))
        assert mae <= MAX_MAE[variable], (
            f"{station} {variable} at {horizon}h: MAE {mae:.2f} exceeds {MAX_MAE[variable]}"
        )


def test_error_does_not_blow_up_with_horizon(walk_forward):
    """24 h error may be worse than 1 h, but not by an order of magnitude."""
    station, errors = walk_forward
    near = _mae(errors[1]["gen_temp_C"])
    far = _mae(errors[24]["gen_temp_C"])
    assert far <= max(near * 10, 1.0), f"{station}: gen_temp MAE 1h={near:.2f} → 24h={far:.2f}"


def test_the_era5_pipeline_is_lossless(walk_forward):
    """Forecast and ground truth read the same reanalysis, so weather error must be ~0."""
    station, errors = walk_forward
    for horizon in HORIZONS_HOURS:
        mae = _mae(errors[horizon]["weather_temp"])
        assert mae < 0.5, f"{station} {horizon}h: ERA5-vs-ERA5 temperature MAE {mae:.3f} °C"
