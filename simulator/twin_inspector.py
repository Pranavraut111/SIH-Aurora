"""
Aurora — the ONE Digital Twin Inspector schema (PROJECT_CONTEXT.md B13).

Both simulator.py (/api/twin-inspector, internal) and unified_backend.py
(/api/twin-inspector, public) build their response with build_twin_inspector(),
so src/components/TwinInspector.jsx always receives the same shape.
"""


def model_assumptions(params: dict) -> dict:
    """Physics parameters with their basis (documented / estimated / assumed)."""
    h, g = params["heating"], params["generator"]
    return {
        "buildings": {
            bld_id: {
                "u_value_W_m2K": {"value": bld["u_value_W_m2K"], "unit": "W/m²K", "basis": "estimated"},
                "surface_area_m2": {"value": bld["surface_area_m2"], "unit": "m²", "basis": "estimated"},
                "target_temp_C": {"value": bld["target_temp_C"], "unit": "°C", "basis": "assumed"},
                "volume_m3": {"value": bld["volume_m3"], "unit": "m³", "basis": "estimated"},
                "occupants": {"value": bld["occupants"], "unit": "persons",
                              "basis": "documented" if bld_id == "livingQuarters" else "estimated"},
                "base_electrical_kW": {"value": bld["base_electrical_kW"], "unit": "kW", "basis": "estimated"},
            }
            for bld_id, bld in params["buildings"].items()
        },
        "heating": {
            "efficiency": {"value": h["efficiency"], "unit": "ratio", "basis": "estimated",
                           "note": "Thermal distribution efficiency (losses in pipes/ducts)"},
            "max_output_kW": {"value": h["max_output_kW"], "unit": "kW", "basis": "estimated"},
            "waste_heat_recovery": {"value": h.get("waste_heat_recovery", 0.15), "unit": "ratio", "basis": "estimated",
                                    "note": "Fraction of heating demand met by generator waste heat recovery; "
                                            "remainder requires dedicated electrical input"},
        },
        "generator": {
            "max_power_kW": {"value": g["max_power_kW"], "unit": "kW", "basis": "estimated"},
            "nominal_rpm": {"value": g["nominal_rpm"], "unit": "rpm", "basis": "documented"},
            "fuel_coeff_a": {"value": g["fuel_coeff_a"], "unit": "L/hr", "basis": "assumed", "note": "Willans line intercept"},
            "fuel_coeff_b": {"value": g["fuel_coeff_b"], "unit": "L/kWh", "basis": "assumed", "note": "Willans line slope"},
            "cooling_efficiency": {"value": g["cooling_efficiency"], "unit": "ratio", "basis": "assumed"},
        },
    }


def build_twin_inspector(*, station_id: str, mode: str, tick_count, values: dict, meta: dict,
                         params: dict, environment_source: str, environment_source_type: str,
                         simulated_time, data_source: dict, telemetry_source: str) -> dict:
    """values: {building: {sensor: number}} (the telemetry being shown);
    meta: physics `_meta` for the same tick; params: StationPhysicsModel.params.
    environment_source_type ∈ {"reanalysis", "real", "synthetic", "hardcoded-demo"}."""
    meta = meta or {}
    lab = values.get("lab", {})
    gen = values.get("generator", {})
    assumptions = model_assumptions(params) if params else {}
    return {
        "stationId": station_id,
        "mode": mode,
        "tickCount": tick_count,
        "telemetrySource": telemetry_source,          # "simulator" | "physics-fallback"
        "environment": {
            "source": environment_source,
            "sourceType": environment_source_type,
            "temperature_C": lab.get("env_temp"),
            "wind_kmh": lab.get("env_wind"),
            "pressure_hPa": lab.get("env_pressure"),
            "humidity_pct": lab.get("env_humidity"),
            "simulatedTime": simulated_time,
        },
        "thermalModel": meta.get("thermal_breakdown", {}),
        "totalHeatLoss_kW": meta.get("total_heat_loss_kW"),
        "heatingDemand_kW": meta.get("heating_demand_kW"),
        "heatingEfficiency": (assumptions.get("heating") or {}).get("efficiency", {}).get("value"),
        "wasteHeatRecovery": (assumptions.get("heating") or {}).get("waste_heat_recovery", {}).get("value"),
        "powerBreakdown": meta.get("power_breakdown", {}),
        "generatorModel": {
            "sourceType": "model-derived",
            "power_kW": gen.get("gen_power"),
            "temperature_C": gen.get("gen_temp"),
            "rpm": gen.get("gen_rpm"),
            "fuelRate_Lhr": gen.get("gen_fuel_rate"),
            "loadFactor_pct": meta.get("gen_load_pct"),
            "maxPower_kW": (assumptions.get("generator") or {}).get("max_power_kW", {}).get("value"),
        },
        "provenance": {
            "environment": environment_source,
            "equipment": "physics model" if mode != "simulation" else "random walk simulation",
        },
        "modelAssumptions": assumptions,
        "dataSource": data_source,
    }
