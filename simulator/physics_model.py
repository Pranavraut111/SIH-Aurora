"""
Aurora v3 — Physics-Based Station Model
Derives equipment telemetry from environmental conditions using
thermal, power, and equipment engineering relationships.

All values are MODEL-DERIVED (🟡), not real sensor measurements.
Parameters are clearly classified as:
  - documented:  from published station specifications
  - estimated:   reasonable engineering estimates
  - assumed:     prototype assumptions, not validated

The causal chain:
  Real weather → Heat loss → Heating demand → Power demand →
  Generator load → Fuel consumption → Generator temperature
"""

import random

import station_config

# ═══════════════════════════════════════════════════════════════
#  Station Physical Parameters
#  Clearly labelled: documented / estimated / assumed
# ═══════════════════════════════════════════════════════════════

STATION_PHYSICS = {
    "maitri": {
        # name / commissioned year come from station_config.json (metadata only)
        "name": station_config.meta_value("maitri", "name"),
        "established": station_config.meta_value("maitri", "commissionedYear"),

        # ── Building envelope (estimated) ─────────────────────
        "buildings": {
            "livingQuarters": {
                "surface_area_m2": 850,       # estimated — main living block
                "u_value_W_m2K": 0.55,        # estimated — older construction
                "target_temp_C": 21,          # assumed — comfortable indoor
                "volume_m3": 2100,            # estimated
                "occupants": 25,              # documented (winter)
                "base_electrical_kW": 18,     # estimated — lighting, cooking, laundry
            },
            "lab": {
                "surface_area_m2": 520,
                "u_value_W_m2K": 0.55,
                "target_temp_C": 18,
                "volume_m3": 1300,
                "occupants": 10,
                "base_electrical_kW": 22,     # research equipment, instruments
            },
            "storage": {
                "surface_area_m2": 380,
                "u_value_W_m2K": 0.70,        # less insulated
                "target_temp_C": 5,           # just above freezing
                "volume_m3": 1100,
                "occupants": 0,
                "base_electrical_kW": 4,
            },
        },

        # ── Generator (estimated from typical Antarctic DG sets) ──
        "generator": {
            "max_power_kW": 200,              # estimated
            "min_power_kW": 30,               # estimated — idle
            "nominal_rpm": 1500,              # documented — 50Hz
            "fuel_coeff_a": 5.0,              # assumed — Willans line intercept (L/hr)
            "fuel_coeff_b": 0.145,            # assumed — Willans line slope (L/kWh)
            "coolant_base_temp_C": 40,        # estimated
            "temp_rise_per_load": 55,         # estimated — max temp rise at full load
            "cooling_efficiency": 0.85,       # assumed
        },

        # ── Heating system (estimated) ────────────────────────
        "heating": {
            "max_output_kW": 120,             # estimated
            "efficiency": 0.88,               # estimated — thermal distribution efficiency
            "waste_heat_recovery": 0.15,      # estimated — fraction of heating met by
                                              #   generator waste heat recovery (typical
                                              #   for diesel-heated Antarctic stations)
            "flow_per_kW": 0.3,               # estimated — L/min per kW
            "supply_temp_C": 72,              # assumed — design supply
            "return_temp_C": 45,              # assumed — design return
        },

        # ── Water system (estimated) ──────────────────────────
        "water": {
            "tank_capacity_L": 15000,         # estimated
            "daily_consumption_L": 600,       # estimated — 25 people × 24L
            "snowmelt_rate_L_hr": 50,         # estimated
            "treatment_power_kW": 3,          # estimated
        },

        # ── Comms (estimated) ─────────────────────────────────
        "comms": {
            "nominal_signal_dBm": -42,        # estimated — typical VSAT
            "wind_attenuation_dB_per_kmh": 0.15,  # estimated
            "bandwidth_Mbps": 2.4,            # estimated
        },

        # ── Storage (documented approximations) ──────────────
        "storage_initial": {
            "fuel_kL": 142,                   # estimated
            "food_days": 186,                 # estimated
            "spares_items": 312,              # estimated
        },
    },

    "bharati": {
        # name / commissioned year come from station_config.json (metadata only)
        "name": station_config.meta_value("bharati", "name"),
        "established": station_config.meta_value("bharati", "commissionedYear"),

        "buildings": {
            "livingQuarters": {
                "surface_area_m2": 780,
                "u_value_W_m2K": 0.40,        # estimated — newer, better insulated
                "target_temp_C": 22,
                "volume_m3": 1950,
                "occupants": 23,
                "base_electrical_kW": 20,
            },
            "lab": {
                "surface_area_m2": 480,
                "u_value_W_m2K": 0.42,
                "target_temp_C": 19,
                "volume_m3": 1200,
                "occupants": 8,
                "base_electrical_kW": 24,
            },
            "storage": {
                "surface_area_m2": 340,
                "u_value_W_m2K": 0.55,
                "target_temp_C": 5,
                "volume_m3": 900,
                "occupants": 0,
                "base_electrical_kW": 3,
            },
        },

        "generator": {
            "max_power_kW": 220,
            "min_power_kW": 35,
            "nominal_rpm": 1500,
            "fuel_coeff_a": 5.5,
            "fuel_coeff_b": 0.140,
            "coolant_base_temp_C": 38,
            "temp_rise_per_load": 50,
            "cooling_efficiency": 0.90,       # newer equipment
        },

        "heating": {
            "max_output_kW": 140,
            "efficiency": 0.92,               # newer system
            "waste_heat_recovery": 0.18,      # estimated — newer station, better recovery
            "flow_per_kW": 0.28,
            "supply_temp_C": 74,
            "return_temp_C": 48,
        },

        "water": {
            "tank_capacity_L": 18000,
            "daily_consumption_L": 550,
            "snowmelt_rate_L_hr": 60,
            "treatment_power_kW": 3.5,
        },

        "comms": {
            "nominal_signal_dBm": -38,
            "wind_attenuation_dB_per_kmh": 0.12,
            "bandwidth_Mbps": 3.1,
        },

        "storage_initial": {
            "fuel_kL": 154,
            "food_days": 210,
            "spares_items": 380,
        },
    },
}


class StationPhysicsModel:
    """
    Derives equipment telemetry from environmental conditions using
    simplified but causal engineering relationships.

    Input:  Real/reanalysis weather (temperature, wind, pressure, humidity)
    Output: Model-derived equipment state (generator, heating, water, comms)

    All outputs carry sourceType = "model-derived".
    """

    def __init__(self, station_id: str):
        self.station_id = station_id
        self.params = STATION_PHYSICS[station_id]

        # Running state (accumulated over time)
        self.fuel_kL = self.params["storage_initial"]["fuel_kL"]
        self.food_days = self.params["storage_initial"]["food_days"]
        self.spares = self.params["storage_initial"]["spares_items"]
        self.water_level_pct = 80.0  # Start at 80%
        self.gen_temp_C = self.params["generator"]["coolant_base_temp_C"]
        self.gen_rpm = self.params["generator"]["nominal_rpm"]
        self.indoor_temps = {}  # building_id -> current indoor temp

        # Initialize indoor temps to targets
        for bld_id, bld in self.params["buildings"].items():
            self.indoor_temps[bld_id] = bld["target_temp_C"]

    def reset_state(self):
        """Reset all running state to initial values.
        Used by anomaly engine to generate independent samples."""
        self.fuel_kL = self.params["storage_initial"]["fuel_kL"]
        self.food_days = self.params["storage_initial"]["food_days"]
        self.spares = self.params["storage_initial"]["spares_items"]
        self.water_level_pct = 80.0
        self.gen_temp_C = self.params["generator"]["coolant_base_temp_C"]
        self.gen_rpm = self.params["generator"]["nominal_rpm"]
        for bld_id, bld in self.params["buildings"].items():
            self.indoor_temps[bld_id] = bld["target_temp_C"]

    def compute(self, weather: dict, dt_seconds: float = 2.0) -> dict:
        """
        Given current weather conditions, compute the full station state.

        Args:
            weather: dict with env_temp, env_wind, env_pressure, env_humidity
            dt_seconds: time step in seconds

        Returns:
            Complete sensor readings dict (building_id -> sensor_id -> {value, unit, sourceType})
        """
        env_temp = weather.get("env_temp", -25)
        env_wind = weather.get("env_wind", 30)
        env_pressure = weather.get("env_pressure", 986)
        env_humidity = weather.get("env_humidity", 50)

        dt_hr = dt_seconds / 3600.0
        gen_params = self.params["generator"]
        heat_params = self.params["heating"]

        # ═══════════════════════════════════════════════════════
        #  STEP 1: Thermal Model — Heat loss per building
        # ═══════════════════════════════════════════════════════
        total_heat_loss_kW = 0
        building_heat_loss = {}

        for bld_id, bld in self.params["buildings"].items():
            indoor = self.indoor_temps.get(bld_id, bld["target_temp_C"])
            delta_T = indoor - env_temp

            # Wind chill effect on heat loss (estimated 2% increase per 10 km/h)
            wind_factor = 1.0 + 0.002 * env_wind

            # Basic heat loss: Q = U × A × ΔT × wind_factor
            heat_loss_W = bld["u_value_W_m2K"] * bld["surface_area_m2"] * delta_T * wind_factor
            heat_loss_kW = heat_loss_W / 1000.0

            # Internal heat gains (people, equipment)
            internal_gains_kW = (bld["occupants"] * 0.1) + (bld["base_electrical_kW"] * 0.3)
            net_loss_kW = max(0, heat_loss_kW - internal_gains_kW)

            building_heat_loss[bld_id] = net_loss_kW
            total_heat_loss_kW += net_loss_kW

        # ═══════════════════════════════════════════════════════
        #  STEP 2: Heating System Response
        # ═══════════════════════════════════════════════════════
        heating_demand_kW = total_heat_loss_kW / heat_params["efficiency"]
        heating_demand_kW = min(heating_demand_kW, heat_params["max_output_kW"])

        # Split between Zone A (60%) and Zone B (40%)
        heat_a_output = heating_demand_kW * 0.6
        heat_b_output = heating_demand_kW * 0.4

        heat_a_flow = heat_a_output * heat_params["flow_per_kW"]
        heat_b_flow = heat_b_output * heat_params["flow_per_kW"]

        # Supply temperature decreases slightly under high load
        load_fraction = heating_demand_kW / heat_params["max_output_kW"]
        heat_a_temp = heat_params["supply_temp_C"] - load_fraction * 5 + random.gauss(0, 0.3)
        heat_b_temp = heat_a_temp - 4 + random.gauss(0, 0.3)

        heat_a_pressure = 3.2 + load_fraction * 0.5 + random.gauss(0, 0.02)

        # ═══════════════════════════════════════════════════════
        #  STEP 3: Power Model
        #  Antarctic stations typically run at 60-85% generator capacity.
        #  Heating is by far the largest electrical consumer.
        # ═══════════════════════════════════════════════════════
        # Base electrical load (lighting, comms, research equipment)
        base_load_kW = sum(b["base_electrical_kW"] for b in self.params["buildings"].values())

        # Heating system electrical consumption
        # Antarctic stations use electric resistance heaters (COP ≈ 1.0)
        # supplemented by waste heat recovery from diesel generators.
        # Only (1 - waste_heat_recovery) of heating demand requires
        # dedicated electrical input.
        waste_heat_frac = heat_params.get("waste_heat_recovery", 0.15)
        heating_electrical_kW = heating_demand_kW * (1.0 - waste_heat_frac)

        water_power_kW = self.params["water"]["treatment_power_kW"]
        comms_power_kW = 1.5
        ventilation_kW = 8.0  # HVAC circulation (estimated)

        total_demand_kW = (base_load_kW + heating_electrical_kW +
                           water_power_kW + comms_power_kW + ventilation_kW)
        # Add realistic noise
        total_demand_kW += random.gauss(0, total_demand_kW * 0.02)
        total_demand_kW = max(gen_params["min_power_kW"],
                              min(gen_params["max_power_kW"], total_demand_kW))

        gen_load_factor = total_demand_kW / gen_params["max_power_kW"]

        # ═══════════════════════════════════════════════════════
        #  STEP 4: Generator Model (Willans line + thermal)
        # ═══════════════════════════════════════════════════════
        fuel_rate = gen_params["fuel_coeff_a"] + gen_params["fuel_coeff_b"] * total_demand_kW
        fuel_rate += random.gauss(0, 0.3)
        fuel_rate = max(0, fuel_rate)

        # Generator temperature: base + load-dependent rise
        target_gen_temp = (
            gen_params["coolant_base_temp_C"] +
            gen_load_factor * gen_params["temp_rise_per_load"] / gen_params["cooling_efficiency"]
        )
        # Smooth approach to target (thermal inertia)
        self.gen_temp_C += (target_gen_temp - self.gen_temp_C) * 0.05
        self.gen_temp_C += random.gauss(0, 0.2)

        # RPM: stable under normal conditions, drops under stress
        target_rpm = gen_params["nominal_rpm"]
        if gen_load_factor > 0.85:
            target_rpm -= (gen_load_factor - 0.85) * 200
        self.gen_rpm += (target_rpm - self.gen_rpm) * 0.1
        self.gen_rpm += random.gauss(0, 3)

        # ═══════════════════════════════════════════════════════
        #  STEP 5: Indoor Temperature Response
        #  Heat is distributed proportionally to each building's
        #  loss share — this models real HVAC balancing valves.
        # ═══════════════════════════════════════════════════════
        for bld_id, bld in self.params["buildings"].items():
            loss = building_heat_loss.get(bld_id, 0)

            # Proportional heat allocation: each building gets
            # heating output in proportion to its share of total loss
            if total_heat_loss_kW > 0:
                loss_share = loss / total_heat_loss_kW
            else:
                loss_share = 1.0 / len(self.params["buildings"])

            heat_input_kW = heating_demand_kW * heat_params["efficiency"] * loss_share

            net_kW = heat_input_kW - loss

            # Temperature change: dT = Q * dt / (m * Cp)
            # thermal_mass in kJ/K = volume * air_density * specific_heat
            thermal_mass = bld["volume_m3"] * 1.2 * 1.005  # kg/m³ × kJ/(kg·K)
            if thermal_mass > 0:
                dT = (net_kW * dt_seconds) / thermal_mass
                self.indoor_temps[bld_id] += dT
                self.indoor_temps[bld_id] += random.gauss(0, 0.05)

            # Prototype stability constraint: prevents indoor temp drift
            # beyond ±3°C of setpoint. Not a real thermostat/PID controller —
            # a proper controller would modulate heating output based on
            # temperature error. This clamp ensures numerical stability
            # until a feedback controller is implemented.
            target = bld["target_temp_C"]
            self.indoor_temps[bld_id] = max(target - 3, min(target + 3, self.indoor_temps[bld_id]))

        # ═══════════════════════════════════════════════════════
        #  STEP 6: Water System
        # ═══════════════════════════════════════════════════════
        consumption_L = self.params["water"]["daily_consumption_L"] * dt_hr / 24
        snowmelt_L = self.params["water"]["snowmelt_rate_L_hr"] * dt_hr
        # Snowmelt efficiency drops in extreme cold
        if env_temp < -40:
            snowmelt_L *= 0.5
        elif env_temp < -30:
            snowmelt_L *= 0.8

        tank_cap = self.params["water"]["tank_capacity_L"]
        water_volume = (self.water_level_pct / 100) * tank_cap
        water_volume += snowmelt_L - consumption_L
        water_volume = max(0, min(tank_cap, water_volume))
        self.water_level_pct = (water_volume / tank_cap) * 100

        water_temp = 12 + env_temp * 0.02 + random.gauss(0, 0.1)
        water_ph = 7.1 + random.gauss(0, 0.015)

        # ═══════════════════════════════════════════════════════
        #  STEP 7: Communications
        # ═══════════════════════════════════════════════════════
        comms_params = self.params["comms"]
        wind_attenuation = env_wind * comms_params["wind_attenuation_dB_per_kmh"]
        signal = comms_params["nominal_signal_dBm"] - wind_attenuation + random.gauss(0, 1)
        signal = max(-120, min(0, signal))

        # Bandwidth degrades with poor signal
        signal_quality = max(0, min(1, (signal + 100) / 60))
        bandwidth = comms_params["bandwidth_Mbps"] * signal_quality + random.gauss(0, 0.05)
        bandwidth = max(0, bandwidth)

        uptime = 99.5 - (1 - signal_quality) * 10 + random.gauss(0, 0.05)
        uptime = max(0, min(100, uptime))

        # ═══════════════════════════════════════════════════════
        #  STEP 8: Storage Depletion
        # ═══════════════════════════════════════════════════════
        self.fuel_kL -= fuel_rate * dt_hr / 1000  # Convert L/hr to kL
        self.fuel_kL = max(0, self.fuel_kL)
        self.food_days -= dt_hr / 24
        self.food_days = max(0, self.food_days)

        # ═══════════════════════════════════════════════════════
        #  STEP 9: CO2 / Humidity model for living quarters
        # ═══════════════════════════════════════════════════════
        lq = self.params["buildings"]["livingQuarters"]
        co2_generation = lq["occupants"] * 0.005  # ppm/s per person (estimated)
        ventilation_rate = 0.003  # air changes per second (estimated)
        co2_base = 400  # outdoor CO2 ppm
        # Steady state: CO2 = outdoor + generation / ventilation
        co2_target = co2_base + co2_generation / ventilation_rate
        co2 = co2_target + random.gauss(0, 10)
        co2 = max(300, min(2000, co2))

        indoor_humidity = 42 + (env_humidity - 50) * 0.1 + random.gauss(0, 0.5)
        indoor_humidity = max(10, min(80, indoor_humidity))

        # ═══════════════════════════════════════════════════════
        #  BUILD OUTPUT (with provenance on every value)
        # ═══════════════════════════════════════════════════════
        def m(value, unit):
            """Model-derived value."""
            return {"value": round(value, 2), "unit": unit, "sourceType": "model-derived"}

        def r(value, unit):
            """Reanalysis value (from weather input)."""
            return {"value": round(value, 2), "unit": unit, "sourceType": "reanalysis"}

        readings = {
            "generator": {
                "gen_power":     m(total_demand_kW, "kW"),
                "gen_fuel_rate": m(fuel_rate, "L/hr"),
                "gen_rpm":       m(self.gen_rpm, "rpm"),
                "gen_temp":      m(self.gen_temp_C, "°C"),
            },
            "heating": {
                "heat_a_flow":     m(heat_a_flow, "L/min"),
                "heat_a_temp":     m(heat_a_temp, "°C"),
                "heat_a_pressure": m(heat_a_pressure, "bar"),
            },
            "heatingB": {
                "heat_b_flow": m(heat_b_flow, "L/min"),
                "heat_b_temp": m(heat_b_temp, "°C"),
            },
            "waterTank": {
                "water_level": m(self.water_level_pct, "%"),
                "water_temp":  m(water_temp, "°C"),
                "water_ph":    m(water_ph, "pH"),
            },
            "commsMast": {
                "comms_signal":    m(signal, "dBm"),
                "comms_bandwidth": m(bandwidth, "Mbps"),
                "comms_uptime":    m(uptime, "%"),
            },
            "livingQuarters": {
                "lq_temp":     m(self.indoor_temps.get("livingQuarters", 21), "°C"),
                "lq_humidity": m(indoor_humidity, "%"),
                "lq_co2":      m(co2, "ppm"),
            },
            "storage": {
                "store_fuel":   m(self.fuel_kL, "kL"),
                "store_food":   m(self.food_days, "days"),
                "store_spares": m(self.spares, "items"),
            },
            "lab": {
                "env_temp":     r(env_temp, "°C"),
                "env_wind":     r(env_wind, "km/h"),
                "env_pressure": r(env_pressure, "hPa"),
                "env_humidity": r(env_humidity, "%"),
            },
        }

        # Full causal-chain breakdown for Digital Twin Inspector
        readings["_meta"] = {
            "heating_demand_kW": round(heating_demand_kW, 1),
            "total_heat_loss_kW": round(total_heat_loss_kW, 1),
            "gen_load_factor": round(gen_load_factor, 3),
            "gen_load_pct": round(gen_load_factor * 100, 1),
            # Power breakdown
            "power_breakdown": {
                "base_electrical_kW": round(base_load_kW, 1),
                "heating_electrical_kW": round(heating_electrical_kW, 1),
                "water_treatment_kW": round(water_power_kW, 1),
                "comms_kW": round(comms_power_kW, 1),
                "ventilation_kW": round(ventilation_kW, 1),
                "total_demand_kW": round(total_demand_kW, 1),
            },
            # Thermal breakdown per building
            "thermal_breakdown": {
                bld_id: {
                    "heat_loss_kW": round(building_heat_loss.get(bld_id, 0), 1),
                    "delta_T": round(self.indoor_temps.get(bld_id, bld["target_temp_C"]) - env_temp, 1),
                }
                for bld_id, bld in self.params["buildings"].items()
            },
            # Provenance summary
            "provenance": {
                "environment": "ERA5 reanalysis (ECMWF)",
                "equipment": "physics model (thermal + power + generator)",
                "classification": {
                    "env_temp": "reanalysis",
                    "env_wind": "reanalysis",
                    "env_pressure": "reanalysis",
                    "env_humidity": "reanalysis",
                    "gen_power": "model-derived",
                    "gen_temp": "model-derived",
                    "gen_fuel_rate": "model-derived",
                    "heat_a_flow": "model-derived",
                    "lq_temp": "model-derived",
                    "comms_signal": "model-derived",
                },
            },
        }

        return readings
