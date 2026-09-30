#!/usr/bin/env python3
"""
Aurora v3 — Phase 4: Forecast Engine

Architecture:
    Weather forecast (Open-Meteo)
            ↓
    Physics twin forward run
            ↓
    Predicted equipment state (30m, 1h, 2h, 4h)
            ↓
    Current trajectory comparison
            ↓
    Degradation risk projection
            ↓
    Structured recommendation

Weather provenance:
    - Source: Open-Meteo Forecast API (GFS/ICON models)
    - NOT reanalysis — these are model predictions
    - Labeled as: 🟠 FORECAST
"""

import os, json, time, copy, math, random
import requests
from datetime import datetime, timedelta

# Local imports
import sys
sys.path.insert(0, os.path.dirname(__file__))
from physics_model import StationPhysicsModel

# ── Station coordinates (shared with weather_data.py) ──────
STATION_COORDS = {
    "maitri":  {"lat": -70.77, "lon": 11.73},
    "bharati": {"lat": -69.41, "lon": 76.19},
}

from config import WEATHER_CACHE_DIR as CACHE_DIR, forecast_cache_path

CACHE_DIR.mkdir(exist_ok=True)
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# ── Forecast horizons ─────────────────────────────────────
HORIZONS = [
    {"label": "+30min", "hours": 0.5},
    {"label": "+1hr",   "hours": 1.0},
    {"label": "+2hr",   "hours": 2.0},
    {"label": "+4hr",   "hours": 4.0},
    {"label": "+6hr",   "hours": 6.0},
    {"label": "+12hr",  "hours": 12.0},
    {"label": "+24hr",  "hours": 24.0},
]


class WeatherForecast:
    """Fetches and caches weather forecast data from Open-Meteo.

    Provenance: 🟠 FORECAST (GFS/ICON model predictions)
    NOT reanalysis — these are model predictions with uncertainty.
    """

    def __init__(self, station_id: str):
        self.station_id = station_id
        self.coords = STATION_COORDS[station_id]
        self.data = None
        self.fetch_time = None

    def fetch(self) -> bool:
        """Fetch forecast, cache for 1 hour."""
        cache_file = forecast_cache_path(self.station_id)

        # Cache valid for 1 hour
        if cache_file.exists():
            with open(cache_file) as f:
                cached = json.load(f)
            age = time.time() - cached.get("fetch_time", 0)
            if age < 3600:
                self.data = cached.get("hourly", {})
                self.fetch_time = cached.get("fetch_time")
                return True

        params = {
            "latitude": self.coords["lat"],
            "longitude": self.coords["lon"],
            "hourly": ",".join([
                "temperature_2m",
                "wind_speed_10m",
                "surface_pressure",
                "relative_humidity_2m",
            ]),
            "forecast_days": 3,
            "timezone": "auto",
        }

        try:
            resp = requests.get(FORECAST_URL, params=params, timeout=15)
            resp.raise_for_status()
            raw = resp.json()

            cached = {
                "fetch_time": time.time(),
                "provenance": {
                    "sourceType": "forecast",
                    "source": "Open-Meteo Forecast API",
                    "model": "GFS/ICON",
                    "note": "Model predictions, NOT reanalysis. Uncertainty increases with horizon.",
                },
                "hourly": raw.get("hourly", {}),
            }

            with open(cache_file, "w") as f:
                json.dump(cached, f, indent=2)

            self.data = cached["hourly"]
            self.fetch_time = time.time()
            print(f"  [{self.station_id}] ✓ Forecast fetched: {len(self.data.get('time', []))} hours")
            return True

        except Exception as e:
            print(f"  [{self.station_id}] ⚠ Forecast fetch failed: {e}")
            return False

    def get_at_hour(self, hours_from_now: float) -> dict:
        """Get forecast weather at a specific time offset."""
        if not self.data or not self.data.get("time"):
            return None

        # Find the nearest data index
        now = datetime.utcnow()
        target = now + timedelta(hours=hours_from_now)

        times = self.data["time"]
        best_idx = 0
        best_diff = float("inf")
        for i, t_str in enumerate(times):
            t = datetime.strptime(t_str, "%Y-%m-%dT%H:%M")
            diff = abs((t - target).total_seconds())
            if diff < best_diff:
                best_diff = diff
                best_idx = i

        def val(key, idx):
            arr = self.data.get(key, [])
            if idx < len(arr) and arr[idx] is not None:
                return arr[idx]
            return None

        return {
            "env_temp": val("temperature_2m", best_idx),
            "env_wind": val("wind_speed_10m", best_idx),
            "env_pressure": val("surface_pressure", best_idx),
            "env_humidity": val("relative_humidity_2m", best_idx),
            "forecast_time": times[best_idx] if best_idx < len(times) else None,
            "hours_ahead": hours_from_now,
        }

    def get_trajectory(self, hours: int = 24) -> list:
        """Get hourly weather trajectory for the next N hours."""
        trajectory = []
        for h in range(hours + 1):
            w = self.get_at_hour(h)
            if w and w.get("env_temp") is not None:
                trajectory.append(w)
        return trajectory


class ForecastEngine:
    """Runs the physics twin forward with forecast weather to predict
    future equipment states.

    Architecture:
        current state → clone physics model → run forward with forecast
        → predicted states at each horizon → compare with normal baseline
        → structured recommendation
    """

    def __init__(self, station_id: str):
        self.station_id = station_id
        self.weather_forecast = WeatherForecast(station_id)
        self._forecast_available = False

    def initialize(self) -> bool:
        """Fetch forecast data."""
        self._forecast_available = self.weather_forecast.fetch()
        return self._forecast_available

    def predict(self, current_physics_model: StationPhysicsModel,
                current_weather: dict,
                current_anomaly: dict = None) -> dict:
        """Generate forecast by running physics twin forward.

        Args:
            current_physics_model: The live physics model (will be cloned)
            current_weather: Current weather conditions
            current_anomaly: Current anomaly detection result (if available)

        Returns:
            Structured forecast with predicted states, weather,
            risk assessment, and recommendation.
        """
        if not self._forecast_available:
            return {"available": False, "reason": "forecast weather not available"}

        # Clone the current physics model state
        forecast_model = StationPhysicsModel(self.station_id)
        forecast_model.fuel_kL = current_physics_model.fuel_kL
        forecast_model.food_days = current_physics_model.food_days
        forecast_model.spares = current_physics_model.spares
        forecast_model.water_level_pct = current_physics_model.water_level_pct
        forecast_model.gen_temp_C = current_physics_model.gen_temp_C
        forecast_model.gen_rpm = current_physics_model.gen_rpm
        forecast_model.indoor_temps = dict(current_physics_model.indoor_temps)

        # Run forward at each horizon
        predictions = []
        prev_hours = 0

        for horizon in HORIZONS:
            hours_ahead = horizon["hours"]
            fw = self.weather_forecast.get_at_hour(hours_ahead)
            if not fw or fw.get("env_temp") is None:
                continue

            # Advance the model from previous horizon to this one
            delta_hours = hours_ahead - prev_hours
            n_steps = max(1, int(delta_hours * 6))  # ~10 min steps
            dt = (delta_hours * 3600) / n_steps

            for _ in range(n_steps):
                readings = forecast_model.compute(fw, dt_seconds=dt)
                meta = readings.pop("_meta", {})

            prev_hours = hours_ahead

            # Extract predicted state
            gen = readings.get("generator", {})
            pred = {
                "horizon": horizon["label"],
                "hours_ahead": hours_ahead,
                "weather": {
                    "env_temp": fw.get("env_temp"),
                    "env_wind": fw.get("env_wind"),
                    "forecast_time": fw.get("forecast_time"),
                    "provenance": "forecast",
                },
                "predicted": {
                    "gen_load_pct": round(meta.get("gen_load_pct", 0), 1),
                    "gen_temp_C": round(
                        gen.get("gen_temp", {}).get("value", 0)
                        if isinstance(gen.get("gen_temp"), dict)
                        else gen.get("gen_temp", 0), 1),
                    "fuel_rate_Lhr": round(
                        gen.get("gen_fuel_rate", {}).get("value", 0)
                        if isinstance(gen.get("gen_fuel_rate"), dict)
                        else gen.get("gen_fuel_rate", 0), 1),
                    "total_demand_kW": round(
                        meta.get("power_breakdown", {}).get("total_demand_kW", 0), 1),
                    "heating_demand_kW": round(meta.get("heating_demand_kW", 0), 1),
                    "fuel_remaining_kL": round(forecast_model.fuel_kL, 1),
                },
            }
            predictions.append(pred)

        # Build risk assessment
        risk = self._assess_risk(predictions, current_weather, current_anomaly)

        return {
            "available": True,
            "stationId": self.station_id,
            "generatedAt": datetime.utcnow().isoformat() + "Z",
            "currentWeather": {
                "env_temp": current_weather.get("env_temp"),
                "env_wind": current_weather.get("env_wind"),
                "provenance": "reanalysis",
            },
            "predictions": predictions,
            "risk": risk,
            "provenance": {
                "weatherSource": "Open-Meteo Forecast API (GFS/ICON)",
                "weatherType": "forecast",
                "physicsModel": "Aurora digital twin forward run",
                "note": "Predictions assume current equipment condition continues. "
                        "Uncertainty increases with forecast horizon.",
            },
        }

    def _assess_risk(self, predictions: list, current_weather: dict,
                     current_anomaly: dict = None) -> dict:
        """Build risk assessment from forecast + current anomaly state."""
        if not predictions:
            return {"level": "unknown", "factors": []}

        factors = []

        # Temperature change
        current_temp = current_weather.get("env_temp", -20)
        last_pred = predictions[-1]
        future_temp = last_pred["weather"].get("env_temp", current_temp)
        temp_delta = future_temp - current_temp

        if temp_delta < -5:
            factors.append({
                "type": "weather_cooling",
                "description": f"Temperature forecast to drop {abs(temp_delta):.1f}°C",
                "severity": min(1.0, abs(temp_delta) / 15),
                "impact": "Heating demand will increase, generator load will rise",
            })
        elif temp_delta > 5:
            factors.append({
                "type": "weather_warming",
                "description": f"Temperature forecast to rise {temp_delta:.1f}°C",
                "severity": 0.2,
                "impact": "Heating demand will decrease slightly",
            })

        # Generator load trend
        if len(predictions) >= 2:
            load_now_pred = predictions[0]["predicted"]["gen_load_pct"]
            load_future = predictions[-1]["predicted"]["gen_load_pct"]
            load_delta = load_future - load_now_pred
            if load_delta > 5:
                factors.append({
                    "type": "load_increase",
                    "description": f"Generator load: {load_now_pred:.1f}% → {load_future:.1f}% (+{load_delta:.1f} percentage points)",
                    "severity": min(1.0, load_delta / 20),
                    "impact": "Higher fuel consumption and generator temperature",
                })

        # Generator temperature trend
        if len(predictions) >= 2:
            temp_now = predictions[0]["predicted"]["gen_temp_C"]
            temp_future = predictions[-1]["predicted"]["gen_temp_C"]
            if temp_future > 85:
                factors.append({
                    "type": "gen_temp_warning",
                    "description": f"Generator temperature forecast to reach {temp_future:.0f}°C",
                    "severity": min(1.0, (temp_future - 75) / 20),
                    "impact": "Elevated thermal stress on generator",
                })

        # Current anomaly state
        if current_anomaly and current_anomaly.get("is_anomaly"):
            score = current_anomaly.get("anomaly_score", 0)
            causes = current_anomaly.get("candidateCauses", [])
            cause_desc = causes[0]["description"] if causes else "unidentified deviation"
            factors.append({
                "type": "active_anomaly",
                "description": f"Active anomaly detected (score {score:.2f}): {cause_desc}",
                "severity": min(1.0, score),
                "impact": "Equipment may degrade further under increased load",
            })

        # Fuel consumption
        if predictions:
            fuel_remaining = predictions[-1]["predicted"].get("fuel_remaining_kL", 999)
            hours_ahead = predictions[-1].get("hours_ahead", 1)
            if fuel_remaining < 10:
                factors.append({
                    "type": "fuel_depletion",
                    "description": f"Fuel projected at {fuel_remaining:.1f} kL in {hours_ahead:.0f}h",
                    "severity": min(1.0, (15 - fuel_remaining) / 15),
                    "impact": "May require resupply planning",
                })

        # Determine overall risk level
        if not factors:
            level = "low"
        else:
            max_severity = max(f["severity"] for f in factors)
            if max_severity > 0.7:
                level = "high"
            elif max_severity > 0.4:
                level = "moderate"
            else:
                level = "low"

        # Generate recommendation
        recommendation = self._build_recommendation(factors, level, predictions)

        return {
            "level": level,
            "factors": factors,
            "recommendation": recommendation,
        }

    def _build_recommendation(self, factors: list, level: str,
                               predictions: list) -> str:
        """Build structured recommendation text from risk factors.

        This is a template-based recommendation, NOT generated by an LLM.
        Groq/LLM can later narrate this as voice, but the content comes
        from the physics model and risk engine.
        """
        if not factors:
            return ("Station operating within normal parameters. "
                    "No significant weather changes forecast. "
                    "Continue standard monitoring.")

        parts = []
        for f in factors:
            if f["type"] == "weather_cooling":
                parts.append(f"Weather: {f['description']}. {f['impact']}.")
            elif f["type"] == "load_increase":
                parts.append(f"Load: {f['description']}. {f['impact']}.")
            elif f["type"] == "gen_temp_warning":
                parts.append(f"Generator: {f['description']}. {f['impact']}.")
            elif f["type"] == "active_anomaly":
                parts.append(f"Anomaly: {f['description']}. {f['impact']}.")
            elif f["type"] == "fuel_depletion":
                parts.append(f"Fuel: {f['description']}. {f['impact']}.")
            else:
                parts.append(f"{f['description']}.")

        if level == "high":
            parts.append("Recommend immediate monitoring of critical systems.")
        elif level == "moderate":
            parts.append("Recommend increased monitoring frequency.")
        else:
            parts.append("Continue standard monitoring.")

        return " ".join(parts)


# ═══════════════════════════════════════════════════════
#  Standalone test
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    for station in ["maitri", "bharati"]:
        print(f"\n{'='*60}")
        print(f"  FORECAST ENGINE — {station.upper()}")
        print(f"{'='*60}")

        engine = ForecastEngine(station)
        available = engine.initialize()
        print(f"  Forecast available: {available}")

        if available:
            pm = StationPhysicsModel(station)
            # Simulate current state
            weather = {"env_temp": -25, "env_wind": 30, "env_pressure": 950, "env_humidity": 60}
            for _ in range(5):
                readings = pm.compute(weather, dt_seconds=120)
                meta = readings.pop("_meta", {})

            result = engine.predict(pm, weather)

            print(f"\n  Predictions:")
            for p in result.get("predictions", []):
                pred = p["predicted"]
                w = p["weather"]
                print(f"    {p['horizon']:>8s}: "
                      f"temp={w['env_temp']:>6.1f}°C  "
                      f"load={pred['gen_load_pct']:>5.1f}%  "
                      f"gen_temp={pred['gen_temp_C']:>5.1f}°C  "
                      f"fuel={pred['fuel_rate_Lhr']:>5.1f} L/hr")

            risk = result.get("risk", {})
            print(f"\n  Risk level: {risk.get('level', '?')}")
            for f in risk.get("factors", []):
                print(f"    [{f['type']}] {f['description']}")
            print(f"\n  Recommendation:")
            print(f"    {risk.get('recommendation', '—')}")
        else:
            print("  ⚠ Running without real forecast — using synthetic test")
            # Demonstrate with synthetic weather sequence
            pm = StationPhysicsModel(station)
            weather = {"env_temp": -20, "env_wind": 25, "env_pressure": 950, "env_humidity": 60}
            for _ in range(5):
                readings = pm.compute(weather, dt_seconds=120)
                meta = readings.pop("_meta", {})

            print(f"\n  Synthetic forecast (temperature dropping):")
            for delta_h, delta_t in [(0.5, -2), (1, -4), (2, -8), (4, -12), (6, -15)]:
                fw = dict(weather)
                fw["env_temp"] += delta_t
                for _ in range(max(1, int(delta_h * 6))):
                    readings = pm.compute(fw, dt_seconds=600)
                    meta = readings.pop("_meta", {})
                gen = readings.get("generator", {})
                gt = gen.get("gen_temp", {})
                gt_val = gt.get("value", 0) if isinstance(gt, dict) else gt
                fr = gen.get("gen_fuel_rate", {})
                fr_val = fr.get("value", 0) if isinstance(fr, dict) else fr
                print(f"    +{delta_h}h: env={fw['env_temp']:>6.1f}°C  "
                      f"load={meta.get('gen_load_pct', 0):>5.1f}%  "
                      f"gen_temp={gt_val:>5.1f}°C  "
                      f"fuel={fr_val:>5.1f} L/hr")
