"""
Aurora v3 — Sensor Simulator (Dual Station, Physics-Based)
Feeds BOTH Maitri and Bharati to the Spring Boot backend.

MODES:
  🟢 REANALYSIS — ERA5 weather → physics thermal/power model → model-derived equipment state
  🔵 SIMULATION — Random walk with organic weather patterns (Developer/Test Mode)

Each station runs independently. Manual injection works in both modes.
Flask control API on port 8001.
"""

import time
import math
import random
import requests
import json
import sys
import os
import threading
from datetime import datetime
from flask import Flask, jsonify, request as flask_request
from flask_cors import CORS

# Import new Phase 1/2 modules
from weather_data import WeatherDataLayer
from physics_model import StationPhysicsModel
import config as app_config  # aliased: 'config' is a loop variable in this module
import logging
from weather_data import sim_hours_per_real_minute

log = logging.getLogger("aurora.simulator")
from config import ALLOWED_ORIGINS, HOST

# Phase 3: Anomaly detection
try:
    from anomaly_engine import AnomalyDetector, extract_features
    ANOMALY_AVAILABLE = True
except ImportError:
    ANOMALY_AVAILABLE = False

# Phase 4: Forecast engine
try:
    from forecast_engine import ForecastEngine
    FORECAST_AVAILABLE = True
except ImportError:
    FORECAST_AVAILABLE = False

# Phase 5: Decision engine
try:
    from decision_engine import DecisionEngine
    DECISION_AVAILABLE = True
except ImportError:
    DECISION_AVAILABLE = False

# Phase 6: Genuine Chronos forecaster (optional — requires torch + chronos-forecasting).
# Only "available" if torch AND chronos actually import (B11).
try:
    from chronos_forecaster import GenuineChronosForecaster, chronos_available
    CHRONOS_AVAILABLE = chronos_available()
except ImportError:
    CHRONOS_AVAILABLE = False
if CHRONOS_AVAILABLE:
    log.info("Chronos available (torch + chronos-forecasting installed)")
else:
    log.info("Chronos unavailable (optional ML extras not installed: pip install -r simulator/requirements-ml.txt)")

# ── Backend endpoint & ports (from config.py / root .env) ─────
BACKEND_URL = f"{app_config.BACKEND_URL}/api/sensors/batch"
TICK_INTERVAL = 2.0  # seconds
CONTROL_PORT = app_config.SIM_PORT

# ── Default mode and replay settings (config.py) ─────────────
# AURORA_DATE defaults to the latest date present in weather_cache/,
# so startup does not need the network. /mode can override at runtime.
DEFAULT_MODE = app_config.AURORA_MODE    # "reanalysis" or "simulation"
DEFAULT_DATE = app_config.AURORA_DATE    # YYYY-MM-DD for replay
DEFAULT_SPEED = app_config.AURORA_SPEED  # 120x = 2 simulated hours per real minute


# ═══════════════════════════════════════════════════════════════
#  Station-Specific Sensor Profiles (for SIMULATION mode only)
# ═══════════════════════════════════════════════════════════════

STATION_PROFILES = {
    "maitri": {
        "name": "Maitri",
        "sensors": {
            "generator": {
                "gen_power":     {"nominal": 160, "step": 2.0,   "min": 0,    "max": 200,  "unit": "kW"},
                "gen_fuel_rate": {"nominal": 28,  "step": 0.5,   "min": 0,    "max": 50,   "unit": "L/hr"},
                "gen_rpm":       {"nominal": 1500,"step": 10.0,  "min": 0,    "max": 2000, "unit": "rpm"},
                "gen_temp":      {"nominal": 82,  "step": 0.5,   "min": 0,    "max": 120,  "unit": "°C"},
            },
            "heating": {
                "heat_a_flow":     {"nominal": 35,  "step": 0.3, "min": 0,  "max": 50,  "unit": "L/min"},
                "heat_a_temp":     {"nominal": 72,  "step": 0.4, "min": 0,  "max": 90,  "unit": "°C"},
                "heat_a_pressure": {"nominal": 3.2, "step": 0.05,"min": 0,  "max": 6,   "unit": "bar"},
            },
            "heatingB": {
                "heat_b_flow": {"nominal": 28, "step": 0.3, "min": 0, "max": 40, "unit": "L/min"},
                "heat_b_temp": {"nominal": 68, "step": 0.4, "min": 0, "max": 90, "unit": "°C"},
            },
            "waterTank": {
                "water_level": {"nominal": 78,  "step": 0.2,  "min": 0, "max": 100, "unit": "%"},
                "water_temp":  {"nominal": 12,  "step": 0.2,  "min": 0, "max": 30,  "unit": "°C"},
                "water_ph":    {"nominal": 7.1, "step": 0.02, "min": 5, "max": 9,   "unit": "pH"},
            },
            "commsMast": {
                "comms_signal":    {"nominal": -42, "step": 1.0,  "min": -120, "max": 0,   "unit": "dBm"},
                "comms_bandwidth": {"nominal": 2.4, "step": 0.1,  "min": 0,    "max": 10,  "unit": "Mbps"},
                "comms_uptime":    {"nominal": 99.2,"step": 0.05, "min": 0,    "max": 100, "unit": "%"},
            },
            "livingQuarters": {
                "lq_temp":     {"nominal": 21,  "step": 0.2, "min": 10, "max": 30,   "unit": "°C"},
                "lq_humidity": {"nominal": 42,  "step": 0.5, "min": 10, "max": 80,   "unit": "%"},
                "lq_co2":      {"nominal": 620, "step": 5.0, "min": 300,"max": 2000, "unit": "ppm"},
            },
            "storage": {
                "store_fuel":   {"nominal": 142, "step": 0.1,  "min": 0, "max": 200, "unit": "kL"},
                "store_food":   {"nominal": 186, "step": 0.08, "min": 0, "max": 365, "unit": "days"},
                "store_spares": {"nominal": 312, "step": 0.05, "min": 0, "max": 500, "unit": "items"},
            },
            "lab": {
                "env_temp":     {"nominal": -33, "step": 0.3, "min": -60, "max": 5,    "unit": "°C"},
                "env_wind":     {"nominal": 35,  "step": 1.5, "min": 0,   "max": 200,  "unit": "km/h"},
                "env_pressure": {"nominal": 986, "step": 0.3, "min": 940, "max": 1040, "unit": "hPa"},
                "env_humidity": {"nominal": 55,  "step": 0.5, "min": 10,  "max": 100,  "unit": "%"},
            },
        },
    },
    "bharati": {
        "name": "Bharati",
        "sensors": {
            "generator": {
                "gen_power":     {"nominal": 172, "step": 2.0,   "min": 0,    "max": 220,  "unit": "kW"},
                "gen_fuel_rate": {"nominal": 32,  "step": 0.5,   "min": 0,    "max": 55,   "unit": "L/hr"},
                "gen_rpm":       {"nominal": 1520,"step": 10.0,  "min": 0,    "max": 2000, "unit": "rpm"},
                "gen_temp":      {"nominal": 78,  "step": 0.5,   "min": 0,    "max": 120,  "unit": "°C"},
            },
            "heating": {
                "heat_a_flow":     {"nominal": 38,  "step": 0.3, "min": 0,  "max": 55,  "unit": "L/min"},
                "heat_a_temp":     {"nominal": 74,  "step": 0.4, "min": 0,  "max": 90,  "unit": "°C"},
                "heat_a_pressure": {"nominal": 3.4, "step": 0.05,"min": 0,  "max": 6,   "unit": "bar"},
            },
            "heatingB": {
                "heat_b_flow": {"nominal": 30, "step": 0.3, "min": 0, "max": 45, "unit": "L/min"},
                "heat_b_temp": {"nominal": 70, "step": 0.4, "min": 0, "max": 90, "unit": "°C"},
            },
            "waterTank": {
                "water_level": {"nominal": 82,  "step": 0.2,  "min": 0, "max": 100, "unit": "%"},
                "water_temp":  {"nominal": 14,  "step": 0.2,  "min": 0, "max": 30,  "unit": "°C"},
                "water_ph":    {"nominal": 7.0, "step": 0.02, "min": 5, "max": 9,   "unit": "pH"},
            },
            "commsMast": {
                "comms_signal":    {"nominal": -38, "step": 1.0,  "min": -120, "max": 0,   "unit": "dBm"},
                "comms_bandwidth": {"nominal": 3.1, "step": 0.1,  "min": 0,    "max": 10,  "unit": "Mbps"},
                "comms_uptime":    {"nominal": 99.5,"step": 0.05, "min": 0,    "max": 100, "unit": "%"},
            },
            "livingQuarters": {
                "lq_temp":     {"nominal": 22,  "step": 0.2, "min": 10, "max": 30,   "unit": "°C"},
                "lq_humidity": {"nominal": 40,  "step": 0.5, "min": 10, "max": 80,   "unit": "%"},
                "lq_co2":      {"nominal": 580, "step": 5.0, "min": 300,"max": 2000, "unit": "ppm"},
            },
            "storage": {
                "store_fuel":   {"nominal": 154, "step": 0.1,  "min": 0, "max": 220, "unit": "kL"},
                "store_food":   {"nominal": 210, "step": 0.08, "min": 0, "max": 365, "unit": "days"},
                "store_spares": {"nominal": 380, "step": 0.05, "min": 0, "max": 550, "unit": "items"},
            },
            "lab": {
                "env_temp":     {"nominal": -25, "step": 0.3, "min": -55, "max": 5,    "unit": "°C"},
                "env_wind":     {"nominal": 28,  "step": 1.5, "min": 0,   "max": 180,  "unit": "km/h"},
                "env_pressure": {"nominal": 998, "step": 0.3, "min": 940, "max": 1040, "unit": "hPa"},
                "env_humidity": {"nominal": 48,  "step": 0.5, "min": 10,  "max": 100,  "unit": "%"},
            },
        },
    },
}

# ── Pre-defined anomaly scenarios ────────────────────────────
SCENARIOS = {
    "generator_failure": {
        "name": "Generator Failure",
        "description": "Generator power drops, RPM falls. Cascades to heating, water, comms.",
        "duration": 30,
        "injections": {
            "generator.gen_power": 25.0,
            "generator.gen_rpm": 600.0,
            "generator.gen_temp": 108.0,
        },
    },
    "heating_failure": {
        "name": "Heating System Failure",
        "description": "Heating Zone A output drops. Living quarters temperature falls.",
        "duration": 25,
        "injections": {
            "heating.heat_a_temp": 32.0,
            "heating.heat_a_flow": 8.0,
            "livingQuarters.lq_temp": 13.0,
        },
    },
    "blizzard": {
        "name": "Blizzard Event",
        "description": "Extreme wind and cold. Comms degrade, heating demand spikes.",
        "duration": 40,
        "injections": {
            "lab.env_wind": 145.0,
            "lab.env_temp": -48.0,
            "commsMast.comms_signal": -95.0,
        },
    },
    "water_crisis": {
        "name": "Water System Alert",
        "description": "Water tank level critical. pH imbalanced.",
        "duration": 20,
        "injections": {
            "waterTank.water_level": 8.0,
            "waterTank.water_ph": 5.4,
        },
    },
    "co2_spike": {
        "name": "CO2 Spike",
        "description": "Ventilation failure — CO2 rising in living quarters.",
        "duration": 20,
        "injections": {
            "livingQuarters.lq_co2": 1600.0,
            "livingQuarters.lq_humidity": 72.0,
        },
    },
}

# ── Organic weather patterns (SIMULATION mode only) ──────────
WEATHER_PATTERNS = {
    "cold_snap": {
        "name": "Cold Snap", "probability": 0.003,
        "duration_range": (30, 60),
        "effects": {
            "lab.env_temp": {"drift": -0.8, "volatility": 1.5},
            "lab.env_wind": {"drift": 0.5, "volatility": 2},
            "lab.env_pressure": {"drift": -0.4, "volatility": 0.5},
        },
    },
    "storm": {
        "name": "Blizzard", "probability": 0.002,
        "duration_range": (40, 80),
        "effects": {
            "lab.env_wind": {"drift": 2.0, "volatility": 4},
            "lab.env_temp": {"drift": -0.5, "volatility": 1},
            "commsMast.comms_signal": {"drift": -2, "volatility": 3},
        },
    },
    "warm_spell": {
        "name": "Warm Front", "probability": 0.002,
        "duration_range": (20, 50),
        "effects": {
            "lab.env_temp": {"drift": 0.6, "volatility": 1},
            "lab.env_pressure": {"drift": 0.3, "volatility": 0.4},
        },
    },
    "signal_interference": {
        "name": "Signal Interference", "probability": 0.0015,
        "duration_range": (20, 40),
        "effects": {
            "commsMast.comms_signal": {"drift": -3, "volatility": 5},
            "commsMast.comms_bandwidth": {"drift": -0.15, "volatility": 0.2},
        },
    },
    "equipment_stress": {
        "name": "Equipment Stress", "probability": 0.001,
        "duration_range": (50, 100),
        "effects": {
            "generator.gen_temp": {"drift": 0.3, "volatility": 0.8},
            "generator.gen_rpm": {"drift": -3, "volatility": 5},
        },
    },
}

# ── Cascade Rules (SIMULATION mode only) ─────────────────────
CASCADE_RULES = [
    {"trigger": "lab.env_temp", "threshold_below": -40,
     "nudges": [("heating.heat_a_flow", 0.3), ("heatingB.heat_b_flow", 0.2),
                ("generator.gen_power", 0.5), ("generator.gen_fuel_rate", 0.15),
                ("generator.gen_temp", 0.1)]},
    {"trigger": "lab.env_temp", "threshold_below": -35,
     "nudges": [("heating.heat_a_flow", 0.15), ("generator.gen_power", 0.3)]},
    {"trigger": "generator.gen_power", "threshold_below": 80,
     "nudges": [("heating.heat_a_temp", -0.5), ("heatingB.heat_b_temp", -0.4),
                ("livingQuarters.lq_temp", -0.3), ("commsMast.comms_signal", -1)]},
    {"trigger": "generator.gen_temp", "threshold_above": 95,
     "nudges": [("generator.gen_rpm", -5), ("generator.gen_power", -1)]},
    {"trigger": "lab.env_wind", "threshold_above": 80,
     "nudges": [("commsMast.comms_signal", -1.5), ("commsMast.comms_bandwidth", -0.05)]},
]


# ═══════════════════════════════════════════════════════════════
#  StationSimulator — Unified for both modes
# ═══════════════════════════════════════════════════════════════

class StationSimulator:
    """
    Independent simulation state for a single station.
    Supports two modes:
      - 'reanalysis': ERA5 weather + physics model
      - 'simulation': Random walk + organic patterns (legacy)
    """

    def __init__(self, station_id: str, mode: str = "reanalysis",
                 date: str = None, speed_factor: float = 120):
        self.station_id = station_id
        self.mode = mode
        self.profile = STATION_PROFILES[station_id]
        self.sensors = self.profile["sensors"]
        self.values = {}  # Current sensor values (flat)
        self.tick_count = 0
        self.active_injections = {}
        self.active_scenario = None
        self.active_patterns = []
        self.event_log = []

        # ── Phase 1/2 modules (reanalysis mode) ──────────────
        self.weather_layer = None
        self.physics_model = None
        self.weather_available = False
        self.anomaly_detector = None
        self._last_anomaly = {"anomaly_score": 0, "is_anomaly": False, "evidence": []}

        if mode == "reanalysis":
            try:
                self.weather_layer = WeatherDataLayer(
                    station_id, date=date, speed_factor=speed_factor
                )
                self.weather_available = self.weather_layer.fetch_and_cache()
                if self.weather_available:
                    self.physics_model = StationPhysicsModel(station_id)
                    self.log_event("mode", f"ERA5 reanalysis mode — physics digital twin active")
                else:
                    print(f"  [{station_id}] ⚠ Weather data unavailable, falling back to simulation")
                    self.mode = "simulation"
            except Exception as e:
                print(f"  [{station_id}] ⚠ Weather init failed: {e}, falling back to simulation")
                self.mode = "simulation"

        # ── Phase 3: Load trained anomaly model ──────────────
        if ANOMALY_AVAILABLE:
            model_path = str(app_config.anomaly_model_path(station_id))
            if os.path.exists(model_path):
                try:
                    self.anomaly_detector = AnomalyDetector(station_id)
                    self.anomaly_detector.load(model_path)
                    print(f"  [{station_id}] ✅ Anomaly detector loaded")
                except Exception as e:
                    print(f"  [{station_id}] ⚠ Anomaly model load failed: {e}")

        # ── Phase 4: Forecast engine ─────────────────────────
        self.forecast_engine = None
        self._last_forecast = None
        self._forecast_tick = 0  # only update forecast every N ticks
        if FORECAST_AVAILABLE:
            try:
                # Reanalysis mode replays a PAST date → live forecast is not time-aligned
                self.forecast_engine = ForecastEngine(station_id, replay_mode=(self.mode == "reanalysis"))
                if self.forecast_engine.initialize():
                    print(f"  [{station_id}] ✅ Forecast engine initialized")
                else:
                    print(f"  [{station_id}] ⚠ Forecast weather unavailable")
            except Exception as e:
                print(f"  [{station_id}] ⚠ Forecast init failed: {e}")

        # ── Phase 5: Decision engine ─────────────────────────
        self.decision_engine = None
        self._last_decision = None
        if DECISION_AVAILABLE:
            try:
                self.decision_engine = DecisionEngine(station_id)
                print(f"  [{station_id}] ✅ Decision engine initialized")
            except Exception as e:
                print(f"  [{station_id}] ⚠ Decision engine init failed: {e}")

        # ── Phase 6: Genuine Chronos forecaster (shared instance) ─
        self._chronos_forecaster = None
        if CHRONOS_AVAILABLE:
            try:
                # Shared singleton: one model in memory, per-station buffers + locks
                if not hasattr(StationSimulator, '_shared_chronos'):
                    StationSimulator._shared_chronos = GenuineChronosForecaster()
                self._chronos_forecaster = StationSimulator._shared_chronos
                print(f"  [{station_id}] ✅ Genuine Chronos forecaster attached")
            except Exception as e:
                log.warning("[%s] Chronos init failed: %s", station_id, e)

        # Initialize values for simulation mode
        for building_id, sensors in self.sensors.items():
            self.values[building_id] = {}
            for sensor_id, config in sensors.items():
                jitter = (random.random() - 0.5) * config["step"] * 4
                initial = max(config["min"], min(config["max"],
                              config["nominal"] + jitter))
                self.values[building_id][sensor_id] = initial

    def _log_stage_error(self, stage: str):
        """Log a tick-stage failure with traceback, once per stage per station
        (subsequent repeats are counted, not re-logged, to avoid log floods)."""
        counts = self.__dict__.setdefault("_stage_errors", {})
        counts[stage] = counts.get(stage, 0) + 1
        if counts[stage] == 1:
            log.exception("[%s] %s stage failed (further repeats suppressed)", self.station_id, stage)

    def log_event(self, event_type: str, message: str):
        self.event_log.append({
            "type": event_type,
            "message": message,
            "timestamp": int(time.time() * 1000),
            "tick": self.tick_count,
        })
        if len(self.event_log) > 100:
            self.event_log.pop(0)

    def tick(self) -> dict:
        """Execute one simulation tick. Returns readings for the backend."""
        self.tick_count += 1

        if self.mode == "reanalysis" and self.weather_available:
            return self._tick_reanalysis()
        else:
            return self._tick_simulation()

    def _tick_reanalysis(self) -> dict:
        """
        REANALYSIS MODE:
        Weather from cached ERA5 → physics model → model-derived equipment.
        Injections override specific values.
        """
        # 1. Get interpolated weather from cached ERA5 data
        weather = self.weather_layer.get_current_weather()
        if weather is None:
            return self._tick_simulation()  # Fallback

        # 2. Run physics model
        physics_readings = self.physics_model.compute(weather, dt_seconds=TICK_INTERVAL)

        # 3. Clean expired injections
        expired = [k for k, v in self.active_injections.items() if self.tick_count > v[1]]
        for k in expired:
            del self.active_injections[k]
        if expired and not self.active_injections:
            self.active_scenario = None

        # 4. Convert physics output to backend format + apply injections
        readings = {}
        meta = physics_readings.pop("_meta", {})

        for building_id, sensors in physics_readings.items():
            readings[building_id] = {}
            for sensor_id, sensor_data in sensors.items():
                key = f"{building_id}.{sensor_id}"
                value = sensor_data["value"]

                # Apply injection override
                if key in self.active_injections:
                    target, _ = self.active_injections[key]
                    current = self.values.get(building_id, {}).get(sensor_id, value)
                    value = current + (target - current) * 0.3
                    sensor_data = {**sensor_data, "sourceType": "synthetic"}

                # Store current value
                if building_id not in self.values:
                    self.values[building_id] = {}
                self.values[building_id][sensor_id] = value

                readings[building_id][sensor_id] = {
                    "value": round(value, 2),
                    "unit": sensor_data["unit"],
                }

        # 5. Store metadata for logging
        self._last_meta = meta
        self._last_weather = weather

        # 6. Phase 3: Anomaly detection (scored every tick)
        if self.anomaly_detector and ANOMALY_AVAILABLE:
            try:
                # Observed (post-injection) vs the physics prediction for this tick
                features = extract_features(weather, self.values, meta, station_id=self.station_id,
                                            predicted=physics_readings)
                self._last_anomaly = self.anomaly_detector.score(features)
            except Exception:
                self._log_stage_error("anomaly")  # never break the main loop

        # 7. Phase 4: Update forecast every 30 ticks (~1 minute)
        if (self.forecast_engine and self.physics_model
                and self.tick_count % 30 == 0):
            try:
                self._last_forecast = self.forecast_engine.predict(
                    self.physics_model, weather, self._last_anomaly
                )
            except Exception:
                self._log_stage_error("forecast")

        # 8. Phase 5: Decision engine (after forecast + anomaly)
        if (self.decision_engine and self.tick_count % 30 == 0):
            try:
                current_state = {
                    "weather": weather,
                    "generator": self.values.get("generator", {}),
                    "meta": meta,
                }
                self._last_decision = self.decision_engine.evaluate(
                    current_state, self._last_anomaly, self._last_forecast
                )
            except Exception:
                self._log_stage_error("decision")

        # 9. Phase 6: Genuine Chronos — append telemetry every tick,
        #    run forecast async every 150 ticks (~5 minutes)
        if self._chronos_forecaster is not None:
            try:
                self._chronos_forecaster.append_telemetry(
                    self.station_id, self.values, meta
                )
                if self.tick_count % 150 == 0:
                    self._chronos_forecaster.run_forecast_async(self.station_id)
            except Exception:
                self._log_stage_error("chronos")  # never break the main loop

        return readings

    def _tick_simulation(self) -> dict:
        """
        SIMULATION MODE (legacy):
        Random walk + organic weather patterns + cascade rules.
        """
        readings = {}

        # 1. Organic weather patterns
        for pattern_id, pattern in WEATHER_PATTERNS.items():
            if any(p["id"] == pattern_id for p in self.active_patterns):
                continue
            if random.random() < pattern["probability"]:
                lo, hi = pattern["duration_range"]
                duration = lo + random.random() * (hi - lo)
                self.active_patterns.append({
                    "id": pattern_id, "name": pattern["name"],
                    "effects": pattern["effects"],
                    "ticks_remaining": int(duration),
                })
                self.log_event("pattern_start", f"{pattern['name']} developing")
                print(f"  [{self.station_id}] Weather: {pattern['name']} starting ({int(duration)} ticks)")

        # 2. Clean expired injections
        expired = [k for k, v in self.active_injections.items() if self.tick_count > v[1]]
        for k in expired:
            del self.active_injections[k]
        if expired and not self.active_injections:
            self.active_scenario = None

        # 3. Tick all sensors
        for building_id, sensors in self.sensors.items():
            readings[building_id] = {}
            for sensor_id, config in sensors.items():
                current = self.values[building_id][sensor_id]
                key = f"{building_id}.{sensor_id}"

                if key in self.active_injections:
                    target, _ = self.active_injections[key]
                    next_val = current + (target - current) * 0.3
                else:
                    mean_reversion = (config["nominal"] - current) * 0.02
                    noise = (random.random() - 0.5) * 2 * config["step"]
                    trend = 0
                    if sensor_id.startswith("env_"):
                        cycle = math.sin(self.tick_count * 0.05)
                        trend = cycle * config["step"] * 0.5
                    if sensor_id.startswith("store_"):
                        trend = -config["step"] * 0.1

                    for pattern in self.active_patterns:
                        effect = pattern["effects"].get(key)
                        if effect:
                            trend += effect["drift"] + (random.random() - 0.5) * effect["volatility"]

                    next_val = current + mean_reversion + noise + trend

                next_val = max(config["min"], min(config["max"], next_val))
                next_val = round(next_val, 2)
                self.values[building_id][sensor_id] = next_val
                readings[building_id][sensor_id] = {"value": next_val, "unit": config["unit"]}

        # 4. Cascade rules
        for rule in CASCADE_RULES:
            b_id, s_id = rule["trigger"].split(".")
            if b_id in self.values and s_id in self.values[b_id]:
                val = self.values[b_id][s_id]
                triggered = False
                if "threshold_below" in rule and val < rule["threshold_below"]:
                    triggered = True
                if "threshold_above" in rule and val > rule["threshold_above"]:
                    triggered = True
                if triggered:
                    for target_key, nudge in rule["nudges"]:
                        tb, ts = target_key.split(".")
                        if tb in self.values and ts in self.values[tb]:
                            cfg = self.sensors.get(tb, {}).get(ts, {})
                            v = self.values[tb][ts] + nudge
                            v = max(cfg.get("min", v), min(cfg.get("max", v), v))
                            self.values[tb][ts] = round(v, 2)

        # 5. Expire weather patterns
        for i in range(len(self.active_patterns) - 1, -1, -1):
            self.active_patterns[i]["ticks_remaining"] -= 1
            if self.active_patterns[i]["ticks_remaining"] <= 0:
                name = self.active_patterns[i]["name"]
                self.log_event("pattern_end", f"{name} subsiding")
                print(f"  [{self.station_id}] Weather: {name} ended")
                self.active_patterns.pop(i)

        return readings

    def inject_scenario(self, scenario_id: str) -> dict:
        scenario = SCENARIOS.get(scenario_id)
        if not scenario:
            return {"error": f"Unknown scenario: {scenario_id}"}

        duration_ticks = int(scenario["duration"] / TICK_INTERVAL)
        expiry = self.tick_count + duration_ticks
        self.active_scenario = scenario_id

        for key, target in scenario["injections"].items():
            self.active_injections[key] = (target, expiry)

        self.log_event("injection", f"Scenario: {scenario['name']}")
        print(f"\n  [{self.station_id}] SCENARIO: {scenario['name']} ({scenario['duration']}s)")
        return {
            "scenario": scenario_id, "name": scenario["name"],
            "station": self.station_id, "duration": scenario["duration"],
        }

    def inject_single(self, building_id, sensor_id, target, duration=20):
        key = f"{building_id}.{sensor_id}"
        if building_id in self.values and sensor_id in self.values[building_id]:
            expiry = self.tick_count + int(duration / TICK_INTERVAL)
            self.active_injections[key] = (target, expiry)
            return {"injected": key, "target": target, "station": self.station_id}
        return {"error": f"Sensor not found: {key}"}

    def reset(self):
        self.active_injections.clear()
        self.active_scenario = None
        self.active_patterns.clear()
        for building_id, sensors in self.sensors.items():
            for sensor_id, config in sensors.items():
                self.values[building_id][sensor_id] = config["nominal"]
        if self.physics_model:
            self.physics_model = StationPhysicsModel(self.station_id)
        self.log_event("reset", "All sensors reset to nominal")
        return {"status": "reset", "station": self.station_id}

    def get_data_source_info(self) -> dict:
        """Return metadata about the current data source for UI display."""
        if self.mode == "reanalysis" and self.weather_available:
            progress = self.weather_layer.get_replay_progress()
            weather = getattr(self, '_last_weather', None)
            return {
                "mode": "reanalysis",
                "label": "ERA5 Reanalysis + Physics Model",
                "sourceType": "reanalysis",
                "dataset": "ERA5 (ECMWF)",
                "replay": progress,
                "simulatedTime": weather.get("simulated_time") if weather else None,
            }
        else:
            return {
                "mode": "simulation",
                "label": "Developer/Test Mode (Synthetic)",
                "sourceType": "synthetic",
            }


# ── Global station simulators ────────────────────────────────
# `stations_lock` is shared by the tick loop and every endpoint that mutates or
# replaces simulators (/inject, /inject-single, /reset, /mode). The tick holds it
# while ticking (not while POSTing), so a /mode rebuild or an injection can never
# interleave with a tick (item 10: /mode race).
stations_lock = threading.RLock()
stations = {
    "maitri": StationSimulator("maitri", mode=DEFAULT_MODE,
                                date=DEFAULT_DATE, speed_factor=DEFAULT_SPEED),
    "bharati": StationSimulator("bharati", mode=DEFAULT_MODE,
                                 date=DEFAULT_DATE, speed_factor=DEFAULT_SPEED),
}


# ── Flask Control API ────────────────────────────────────────
control_app = Flask(__name__)
CORS(control_app, origins=ALLOWED_ORIGINS, supports_credentials=False)


@control_app.route("/scenarios", methods=["GET"])
def list_scenarios():
    result = {}
    for sid, s in SCENARIOS.items():
        result[sid] = {
            "name": s["name"], "description": s["description"],
            "duration": s["duration"],
            "affectedSensors": list(s["injections"].keys()),
        }
    station_id = flask_request.args.get("station", "maitri")
    sim = stations.get(station_id, stations["maitri"])
    return jsonify({
        "scenarios": result,
        "activeScenario": sim.active_scenario,
        "activeInjections": len(sim.active_injections),
        "activePatterns": [p["name"] for p in sim.active_patterns],
        "tickCount": sim.tick_count,
        "station": station_id,
        "dataSource": sim.get_data_source_info(),
    })


@control_app.route("/inject/<scenario_id>", methods=["POST"])
def inject_scenario(scenario_id):
    station_id = flask_request.args.get("station", "maitri")
    with stations_lock:
        sim = stations.get(station_id, stations["maitri"])
        result = sim.inject_scenario(scenario_id)
    return jsonify(result)


@control_app.route("/inject-single", methods=["POST"])
def inject_single():
    data = flask_request.json
    station_id = data.get("stationId", "maitri")
    with stations_lock:
        sim = stations.get(station_id, stations["maitri"])
        result = sim.inject_single(
            data.get("buildingId", ""), data.get("sensorId", ""),
            data.get("target", 0), data.get("duration", 20),
        )
    return jsonify(result)


@control_app.route("/reset", methods=["POST"])
def reset():
    station_id = flask_request.args.get("station", "maitri")
    with stations_lock:
        sim = stations.get(station_id, stations["maitri"])
        result = sim.reset()
    return jsonify(result)


@control_app.route("/api/twin-inspector", methods=["GET"])
def twin_inspector():
    """Digital Twin Inspector — exposes full causal-chain breakdown."""
    station_id = flask_request.args.get("station", "maitri")
    sim = stations.get(station_id, stations["maitri"])

    meta = getattr(sim, '_last_meta', {})
    weather = getattr(sim, '_last_weather', None)

    # Build model assumptions from physics params if available
    assumptions = {}
    if sim.physics_model:
        p = sim.physics_model.params
        h = p["heating"]
        g = p["generator"]
        assumptions = {
            "buildings": {
                bld_id: {
                    "u_value_W_m2K": {"value": bld["u_value_W_m2K"], "unit": "W/m²K", "basis": "estimated"},
                    "surface_area_m2": {"value": bld["surface_area_m2"], "unit": "m²", "basis": "estimated"},
                    "target_temp_C": {"value": bld["target_temp_C"], "unit": "°C", "basis": "assumed"},
                    "volume_m3": {"value": bld["volume_m3"], "unit": "m³", "basis": "estimated"},
                    "occupants": {"value": bld["occupants"], "unit": "persons", "basis": "documented" if bld_id == "livingQuarters" else "estimated"},
                    "base_electrical_kW": {"value": bld["base_electrical_kW"], "unit": "kW", "basis": "estimated"},
                }
                for bld_id, bld in p["buildings"].items()
            },
            "heating": {
                "efficiency": {"value": h["efficiency"], "unit": "ratio", "basis": "estimated",
                               "note": "Thermal distribution efficiency (losses in pipes/ducts)"},
                "max_output_kW": {"value": h["max_output_kW"], "unit": "kW", "basis": "estimated"},
                "waste_heat_recovery": {"value": h.get("waste_heat_recovery", 0.15), "unit": "ratio", "basis": "estimated",
                                        "note": "Fraction of heating demand met by generator waste heat recovery; remainder requires dedicated electrical input"},
            },
            "generator": {
                "max_power_kW": {"value": g["max_power_kW"], "unit": "kW", "basis": "estimated"},
                "nominal_rpm": {"value": g["nominal_rpm"], "unit": "rpm", "basis": "documented"},
                "fuel_coeff_a": {"value": g["fuel_coeff_a"], "unit": "L/hr", "basis": "assumed", "note": "Willans line intercept"},
                "fuel_coeff_b": {"value": g["fuel_coeff_b"], "unit": "L/kWh", "basis": "assumed", "note": "Willans line slope"},
                "cooling_efficiency": {"value": g["cooling_efficiency"], "unit": "ratio", "basis": "assumed"},
            },
        }

    result = {
        "stationId": station_id,
        "mode": sim.mode,
        "tickCount": sim.tick_count,
        "environment": {
            "source": "ERA5 reanalysis (ECMWF)" if sim.mode == "reanalysis" else "Synthetic simulation",
            "sourceType": "reanalysis" if sim.mode == "reanalysis" else "synthetic",
            "temperature_C": sim.values.get("lab", {}).get("env_temp"),
            "wind_kmh": sim.values.get("lab", {}).get("env_wind"),
            "pressure_hPa": sim.values.get("lab", {}).get("env_pressure"),
            "humidity_pct": sim.values.get("lab", {}).get("env_humidity"),
            "simulatedTime": weather.get("simulated_time") if weather else None,
        },
        "thermalModel": meta.get("thermal_breakdown", {}),
        "totalHeatLoss_kW": meta.get("total_heat_loss_kW"),
        "heatingDemand_kW": meta.get("heating_demand_kW"),
        "heatingEfficiency": assumptions.get("heating", {}).get("efficiency", {}).get("value"),
        "wasteHeatRecovery": h.get("waste_heat_recovery", 0.15) if sim.physics_model else 0.15,
        "powerBreakdown": meta.get("power_breakdown", {}),
        "generatorModel": {
            "sourceType": "model-derived",
            "power_kW": sim.values.get("generator", {}).get("gen_power"),
            "temperature_C": sim.values.get("generator", {}).get("gen_temp"),
            "rpm": sim.values.get("generator", {}).get("gen_rpm"),
            "fuelRate_Lhr": sim.values.get("generator", {}).get("gen_fuel_rate"),
            "loadFactor_pct": meta.get("gen_load_pct"),
            "maxPower_kW": assumptions.get("generator", {}).get("max_power_kW", {}).get("value"),
        },
        "provenance": meta.get("provenance", {
            "environment": "synthetic" if sim.mode == "simulation" else "ERA5 reanalysis",
            "equipment": "physics model" if sim.mode == "reanalysis" else "random walk simulation",
        }),
        "modelAssumptions": assumptions,
        "dataSource": sim.get_data_source_info(),
    }
    return jsonify(result)


@control_app.route("/api/anomaly", methods=["GET"])
def anomaly_status():
    """Phase 3: Anomaly detection status and evidence."""
    station_id = flask_request.args.get("station", "maitri")
    sim = stations.get(station_id, stations["maitri"])

    anomaly = getattr(sim, '_last_anomaly', {"anomaly_score": 0, "is_anomaly": False, "evidence": []})

    return jsonify({
        "stationId": station_id,
        "anomalyScore": anomaly.get("anomaly_score", 0),
        "scoreType": anomaly.get("scoreType", "isolation_forest_path_score"),
        "threshold": anomaly.get("threshold", 0.5),
        "isAnomaly": anomaly.get("is_anomaly", False),
        "evidence": anomaly.get("evidence", []),
        "candidateCauses": anomaly.get("candidateCauses", []),
        # v3: which rule fired ("isolation_forest" and/or "residual_z") + largest residual
        "triggeredBy": anomaly.get("triggeredBy", []),
        "maxResidualSigma": anomaly.get("maxResidualSigma"),
        "residualAlarmSigma": anomaly.get("residualAlarmSigma"),
        "detectorAvailable": sim.anomaly_detector is not None if hasattr(sim, 'anomaly_detector') else False,
    })


@control_app.route("/api/forecast", methods=["GET"])
def forecast_status():
    """Phase 4: Forecast predictions, risk, and recommendation."""
    station_id = flask_request.args.get("station", "maitri")
    sim = stations.get(station_id, stations["maitri"])

    forecast = getattr(sim, '_last_forecast', None)
    if forecast and forecast.get("available"):
        return jsonify(forecast)
    else:
        return jsonify({
            "available": False,
            "stationId": station_id,
            "reason": "Forecast not yet computed or weather unavailable",
        })


@control_app.route("/api/decision", methods=["GET"])
def decision_status():
    """Phase 5: Decision engine output with audit trail."""
    station_id = flask_request.args.get("station", "maitri")
    sim = stations.get(station_id, stations["maitri"])

    decision = getattr(sim, '_last_decision', None)
    if decision:
        return jsonify(decision)
    else:
        return jsonify({
            "stationId": station_id,
            "event": {"type": "normal", "description": "Decision engine not yet computed"},
            "risk": {"level": "unknown"},
        })


@control_app.route("/api/chronos-forecast", methods=["GET"])
def chronos_forecast():
    """Phase 6: Genuine Chronos time-series forecast (independent of physics)."""
    station_id = flask_request.args.get("station", "maitri")
    sim = stations.get(station_id, stations["maitri"])

    if not CHRONOS_AVAILABLE:
        return jsonify({
            "available": False,
            "reason": "Chronos unavailable (optional ML extras not installed)",
        })

    forecaster = getattr(sim, '_chronos_forecaster', None)
    if forecaster is None:
        return jsonify({
            "available": False,
            "reason": "Chronos forecaster not initialized",
        })

    return jsonify(forecaster.get_cached_forecast(station_id))


@control_app.route("/api/chronos-status", methods=["GET"])
def chronos_status():
    """Phase 6: Chronos forecaster status and buffer info."""
    if not CHRONOS_AVAILABLE:
        return jsonify({
            "chronos_available": False,
            "model_loaded": False,
            "reason": "Chronos unavailable (optional ML extras not installed)",
        })

    # Get the shared forecaster from any station
    for sid, sim in stations.items():
        forecaster = getattr(sim, '_chronos_forecaster', None)
        if forecaster:
            return jsonify(forecaster.status())

    return jsonify({"chronos_available": True, "initialized": False})


@control_app.route("/mode", methods=["POST"])
def set_mode():
    """Switch simulation mode at runtime."""
    data = flask_request.json or {}
    new_mode = data.get("mode", "reanalysis")
    date = data.get("date", None)
    speed = float(data.get("speed", 120))

    # Build replacements OUTSIDE the lock (may download weather), then swap
    # atomically under the lock shared with the tick loop.
    rebuilt = {
        sid: StationSimulator(sid, mode=new_mode, date=date, speed_factor=speed)
        for sid in list(stations.keys())
    }
    with stations_lock:
        stations.update(rebuilt)

    return jsonify({
        "status": "ok",
        "mode": new_mode,
        "date": date,
        "speed": speed,
        "stations": list(stations.keys()),
    })


@control_app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "UP",
        "service": "aurora-simulator-v3-physics",
        "stations": {
            sid: {
                "tickCount": s.tick_count,
                "mode": s.mode,
                "activeScenario": s.active_scenario,
                "activeInjections": len(s.active_injections),
                "activePatterns": [p["name"] for p in s.active_patterns],
                "dataSource": s.get_data_source_info(),
            }
            for sid, s in stations.items()
        },
    })


# ── Phase 6: Groq Explanation Layer ──────────────────────────
# Groq is STRICTLY the communication layer.
# It receives validated structured JSON from the decision engine
# and turns it into human-readable explanations.
# Groq does NOT invent intelligence — it explains the pipeline's output.
#
# Architecture:
#   /api/decision → validated JSON → Groq → operator explanation
#
# Key ONLY from the environment (never hardcoded, never sent to the browser).
GROQ_API_KEY = app_config.GROQ_API_KEY
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = app_config.GROQ_MODEL
# Honest client identification (no spoofed User-Agent).
GROQ_USER_AGENT = "Aurora-DigitalTwin/1.0 (+https://github.com/Saeesh-Vele/SIH2026A)"
# Operator free text is untrusted: cap its length and only ever place it in
# the *user* message, never in the system prompt.
MAX_USER_TEXT_CHARS = 500
LLM_UNAVAILABLE_MSG = (
    "LLM explanation unavailable: GROQ_API_KEY is not configured on the server. "
    "The structured decision data (/api/decision) is still available."
)


def _llm_available() -> bool:
    return bool(GROQ_API_KEY)


def _clean_user_text(value, limit: int = MAX_USER_TEXT_CHARS) -> str:
    """Coerce untrusted operator input to a bounded plain string."""
    if value is None:
        return ""
    text = str(value).replace("\x00", "").strip()
    return text[:limit]


def _json_body() -> dict:
    """Parse the request body without raising on bad/missing JSON."""
    data = flask_request.get_json(silent=True)
    return data if isinstance(data, dict) else {}

AURORA_SYSTEM_PROMPT = """You are Aurora, the AI operations assistant for Indian Antarctic Research Stations (Maitri and Bharati), operated by NCPOR under the Ministry of Earth Sciences.

CRITICAL RULES:
1. You ONLY describe facts provided in the DECISION_DATA JSON. NEVER invent sensor values, predictions, or risk assessments.
2. Your job is to EXPLAIN the decision engine's output in clear language — not to diagnose equipment yourself.
3. Every claim you make must trace to a specific field in the provided data.
4. Use Celsius, kW, km/h, kL, L/hr as units. Use precise numbers from the data.
5. Distinguish provenance: say "the physics model predicts" not "I predict". Say "the anomaly detector indicates" not "I detected".
6. Keep responses concise: 3-5 sentences for status, up to 8 for detailed explanations.
7. If asked "why", explain the evidence and triggered risk rules from the data.
8. If asked "what should I do", read the recommendation from the data — do not generate your own.
9. You can respond in Hindi, English, or mixed Hindi-English if the user asks in Hindi.
10. Always end with the confidence level and action type from the recommendation.
11. Candidate causes are POSSIBLE explanations, not confirmed failures. Use words like "possible", "candidate", "indicated".
12. All degradation assessments are against synthetic prototype signatures — do not claim production-validated diagnosis."""

QUESTION_PROMPTS = {
    "status": "Provide a brief operational status summary for this station based on the decision data.",
    "why": "Explain WHY the risk level is what it is. Reference the specific triggered rules and evidence.",
    "action": "What should the operator do? Read the recommendation from the decision data. Do not generate your own actions.",
    "detail": "Provide a detailed explanation of the current situation, including evidence, forecast, impact, and recommendation.",
}


def _call_groq(system_prompt: str, user_prompt: str, max_tokens: int = 400) -> str:
    """Call Groq API with the given prompts. Returns explanation text."""
    if not _llm_available():
        return LLM_UNAVAILABLE_MSG
    try:
        import urllib.request
        req = urllib.request.Request(
            GROQ_API_URL,
            data=json.dumps({
                "model": GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.2, "max_tokens": max_tokens,
            }).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "User-Agent": GROQ_USER_AGENT,
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            return result["choices"][0]["message"]["content"]
    except Exception as e:
        err_msg = str(e)
        if hasattr(e, 'read'):
            try:
                err_msg = e.read().decode()
            except Exception:
                pass
        print(f"  [Groq] Error: {err_msg}")
        return "LLM explanation temporarily unavailable (upstream error; see server log)."


@control_app.route("/api/aurora-explain", methods=["POST"])
def aurora_explain():
    """Phase 6: Decision-aware Groq explanation endpoint.

    Groq receives the validated decision JSON and turns it into
    a human-readable explanation. It does NOT invent intelligence.

    Request body:
        question: "status" | "why" | "action" | "detail" | free-text
        station: "maitri" | "bharati" (default: maitri)
    """
    data = _json_body()
    question_type = _clean_user_text(data.get("question", "status"), 32) or "status"
    station_id = _clean_user_text(data.get("station", "maitri"), 32) or "maitri"
    free_text = _clean_user_text(data.get("freeText", ""))

    # Get the latest decision for this station
    sim = stations.get(station_id, stations.get("maitri"))
    decision = getattr(sim, '_last_decision', None)

    if not decision:
        return jsonify({
            "explanation": "Decision engine has not yet computed a result for this station.",
            "sources": [],
            "llmAvailable": _llm_available(),
        })

    # Build the decision context (exclude audit trail for token efficiency)
    decision_compact = {k: v for k, v in decision.items() if k != "auditTrail"}
    decision_str = json.dumps(decision_compact, indent=2, default=str)[:4000]

    # Build the question prompt
    if question_type in QUESTION_PROMPTS:
        question = QUESTION_PROMPTS[question_type]
    elif free_text:
        question = free_text
    else:
        question = QUESTION_PROMPTS["status"]

    user_prompt = f"DECISION_DATA:\n{decision_str}\n\nQUESTION: {question}"

    explanation = _call_groq(AURORA_SYSTEM_PROMPT, user_prompt)

    # Determine which data sources contributed
    sources = []
    if decision.get("currentState"):
        sources.append("current_telemetry")
    if decision.get("evidence"):
        for ev in decision["evidence"]:
            if ev.get("source") == "anomaly_detector_v2":
                sources.append("anomaly_v2")
                break
        for ev in decision["evidence"]:
            if ev.get("source") == "forecast_engine":
                sources.append("forecast_engine")
                break
    if decision.get("risk", {}).get("triggered_rules"):
        sources.append("decision_engine")
    sources = list(dict.fromkeys(sources))  # deduplicate, preserve order

    return jsonify({
        "explanation": explanation,
        "llmAvailable": _llm_available(),
        "sources": sources,
        "questionType": question_type,
        "riskLevel": decision.get("risk", {}).get("level", "unknown"),
        "event": decision.get("event", {}),
        "provenance": decision.get("provenance", {}),
    })


# Keep legacy /api/explain for backward compatibility
@control_app.route("/api/explain", methods=["POST"])
def explain():
    """Legacy explain endpoint — now delegates to aurora-explain."""
    data = _json_body()
    query = _clean_user_text(data.get("query", ""))
    station = _clean_user_text(data.get("station", "maitri"), 32) or "maitri"

    # Map to new endpoint
    sim = stations.get(station, stations.get("maitri"))
    decision = getattr(sim, '_last_decision', None)

    if not _llm_available():
        return jsonify({"explanation": LLM_UNAVAILABLE_MSG, "llmAvailable": False}), 200
    if decision:
        decision_compact = {k: v for k, v in decision.items() if k != "auditTrail"}
        decision_str = json.dumps(decision_compact, indent=2, default=str)[:3000]
        context = data.get("context", {})
        context_str = json.dumps(context, indent=2, default=str)[:1500]
        user_prompt = f"DECISION_DATA:\n{decision_str}\n\nADDITIONAL CONTEXT:\n{context_str}\n\nQUESTION: {query}"
        explanation = _call_groq(AURORA_SYSTEM_PROMPT, user_prompt)
        return jsonify({"explanation": explanation})
    context = data.get("context", {})
    context_str = json.dumps(context, indent=2, default=str)[:3000]
    user_prompt = f"STATION DATA:\n{context_str}\n\nQUESTION: {query}"
    explanation = _call_groq(AURORA_SYSTEM_PROMPT, user_prompt)
    return jsonify({"explanation": explanation})


@control_app.route("/api/explain/incident", methods=["POST"])
def explain_incident():
    """Legacy incident explanation — now decision-aware."""
    if not _llm_available():
        return jsonify({"explanation": LLM_UNAVAILABLE_MSG, "llmAvailable": False}), 200
    data = _json_body()
    incident = data.get("incident", {})
    if not isinstance(incident, dict):
        incident = {}
    station = _clean_user_text(data.get("station", "maitri"), 32) or "maitri"

    # Include decision context if available
    sim = stations.get(station, stations.get("maitri"))
    decision = getattr(sim, '_last_decision', None)
    decision_str = ""
    if decision:
        decision_compact = {k: v for k, v in decision.items() if k != "auditTrail"}
        decision_str = f"\n\nDECISION ENGINE CONTEXT:\n{json.dumps(decision_compact, indent=2, default=str)[:2000]}"

    # Incident fields come from the browser: treat as untrusted, bounded text
    # (user message only — never the system prompt).
    def field(key, default):
        return _clean_user_text(incident.get(key, default), 200) or default
    affected_raw = incident.get("affectedSystems", [])
    affected = [
        _clean_user_text(a.get("name", ""), 60)
        for a in (affected_raw if isinstance(affected_raw, list) else [])
        if isinstance(a, dict)
    ][:20]

    prompt = f"""Explain this incident briefly (3-4 sentences):
INCIDENT: {field('title', 'Unknown')}
RISK: {field('riskLevel', 'Unknown')}
CAUSE: {field('cause', 'Unknown')}
BUILDING: {field('rootBuildingName', 'Unknown')}
AFFECTED: {', '.join(affected)}
RECOMMENDED ACTION: {field('recommendedAction', 'None')}{decision_str}"""

    explanation = _call_groq(AURORA_SYSTEM_PROMPT, prompt, max_tokens=200)
    return jsonify({"explanation": explanation})


def run_control_server():
    control_app.run(host=HOST, port=CONTROL_PORT, debug=False, use_reloader=False)


# ── Main loop — ticks BOTH stations independently ────────────
def main():
    print("=" * 64)
    print("  Aurora v3 — Physics-Based Digital Twin Simulator")
    print(f"  Mode: {DEFAULT_MODE.upper()}")
    if DEFAULT_DATE:
        print(f"  Replay date: {DEFAULT_DATE} (source: {app_config.AURORA_DATE_SOURCE})")
    print(f"  Speed: {DEFAULT_SPEED}x ({sim_hours_per_real_minute(DEFAULT_SPEED):.1f} simulated hours per real minute)")
    print(f"  Stations: {', '.join(STATION_PROFILES.keys())}")
    print(f"  Backend: {BACKEND_URL}")
    print(f"  Control API: http://{HOST}:{CONTROL_PORT}  (CORS: {', '.join(ALLOWED_ORIGINS)})")
    groq_status = "configured" if GROQ_API_KEY else "NOT SET"
    print(f"  Groq API: {groq_status}")
    print("=" * 64)
    print()

    # Start Flask control API
    control_thread = threading.Thread(target=run_control_server, daemon=True)
    control_thread.start()
    print(f"  Control API running on http://{HOST}:{CONTROL_PORT}")
    print()

    consecutive_errors = 0
    max_errors = 10

    while True:
        try:
            # Tick + build payloads under the lock; POST outside it.
            payloads = []
            with stations_lock:
                current = dict(stations)
                for station_id, sim in current.items():
                    readings = sim.tick()
                    source_info = sim.get_data_source_info()
                    payloads.append({
                        "stationId": station_id,
                        "timestamp": int(time.time() * 1000),
                        "readings": readings,
                        "eventTimeline": sim.event_log[-50:],
                        "activePatterns": [p["name"] for p in sim.active_patterns],
                        # Provenance hints for the unified backend (additive, optional fields)
                        "mode": source_info.get("mode"),
                        "activeScenario": sim.active_scenario,
                        "injectedSensors": sorted(sim.active_injections.keys()),
                        "weatherSource": source_info.get("dataset") or source_info.get("label"),
                    })

            for payload in payloads:
                try:
                    response = requests.post(
                        BACKEND_URL, json=payload, timeout=5,
                        headers={"Content-Type": "application/json"},
                    )
                    if response.status_code == 200:
                        consecutive_errors = 0
                    else:
                        consecutive_errors += 1
                except requests.exceptions.ConnectionError:
                    consecutive_errors += 1
                    if consecutive_errors == 1:
                        print(f"  Waiting for backend at {BACKEND_URL}...")

            # Print status (alternate stations)
            active_sid = "maitri" if current["maitri"].tick_count % 2 == 0 else "bharati"
            sim = current[active_sid]
            ts = datetime.now().strftime("%H:%M:%S")
            temp = sim.values.get("lab", {}).get("env_temp", 0)
            power = sim.values.get("generator", {}).get("gen_power", 0)
            patterns = [p["name"] for p in sim.active_patterns]

            mode_tag = "ERA5" if sim.mode == "reanalysis" else "SIM"
            meta = getattr(sim, '_last_meta', {})
            load_pct = meta.get("gen_load_pct", 0)

            status = f"[{ts}] {active_sid:>7s} #{sim.tick_count:>4d}"
            status += f" | {temp:>6.1f}C | {power:>6.1f}kW"
            status += f" | {load_pct:>4.1f}%"
            status += f" | {mode_tag}"
            if patterns:
                status += f" | W: {', '.join(patterns)}"
            if sim.active_scenario:
                status += f" | S: {SCENARIOS[sim.active_scenario]['name']}"

            # Show simulated time in reanalysis mode
            weather = getattr(sim, '_last_weather', None)
            if weather and 'simulated_time' in weather:
                sim_time = weather['simulated_time'][:16]
                status += f" | T:{sim_time}"

            print(status)

        except Exception as e:
            consecutive_errors += 1
            print(f"  Error: {e}")

        if consecutive_errors >= max_errors:
            consecutive_errors = 0

        time.sleep(TICK_INTERVAL)


if __name__ == "__main__":
    main()
