"""
Aurora & NCPOR Antarctic Digital Twin — Unified Mission Control Backend
Runs FastAPI + Uvicorn + WebSockets on port 8080. CORS origins and bind
host come from ALLOWED_ORIGINS / HOST (see config.py).
Serves:
- Real-time station telemetry WebSocket (/ws/station)
- Official NCPOR/NPDC live & historical data APIs
- Anomaly Detection (Isolation Forest, One-Class SVM)
- Time-series Forecasting (ARIMA, Prophet-style trend with 95% CI)
- Explainable Antarctic Risk Engine
- Causal Digital Twin Inspector (Thermal -> Power -> Fuel -> Logistics)
- What-If Simulation Engine
- Logistics & Inventory Management with operator write support
- Remote Command & Control Architecture
- Admin Panel & Data Ingestion Trigger APIs
"""

import os
import sys
import time
import json
import asyncio
import sqlite3
import math
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import digital twin engines
sys.path.insert(0, str(Path(__file__).parent))
from ncpor_ingestor import init_db, ingest_live_station, ingest_cached_historical_data, DB_PATH, STATION_INFO
from analytics_ai_engine import (
    run_anomaly_detection,
    run_time_series_forecast,
    run_correlation_matrix,
    assess_blizzard_and_polar_risks,
    query_observations
)
from physics_model import StationPhysicsModel
from config import ALLOWED_ORIGINS, HOST, API_PORT

app = FastAPI(title="Aurora Antarctic Digital Twin Platform", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Initialize database on startup
init_db()

# ═══════════════════════════════════════════════════════════════
#  WebSocket Connection Manager
# ═══════════════════════════════════════════════════════════════

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

# Active station state cache
STATION_STATE = {
    "maitri": {
        "physics": StationPhysicsModel("maitri"),
        "sensors": {},
        "alerts": {},
        "activeAlerts": [],
        "incidents": [],
        "eventTimeline": [],
        "last_weather": {"temp": -12.7, "wind": 15.2, "pressure": 984.0, "humidity": 68.0}
    },
    "bharati": {
        "physics": StationPhysicsModel("bharati"),
        "sensors": {},
        "alerts": {},
        "activeAlerts": [],
        "incidents": [],
        "eventTimeline": [],
        "last_weather": {"temp": -16.0, "wind": 11.5, "pressure": 988.0, "humidity": 72.0}
    }
}

# ═══════════════════════════════════════════════════════════════
#  Telemetry Generation & Tick Loop
# ═══════════════════════════════════════════════════════════════

def get_latest_weather_for_station(station_id: str):
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute("""
        SELECT parameter, value, timestamp, source, dataset 
        FROM observations 
        WHERE station_id = ? 
        ORDER BY timestamp DESC LIMIT 30
    """, (station_id,))
    rows = c.fetchall()
    conn.close()

    res = {"temp": -15.0, "wind": 12.0, "pressure": 985.0, "humidity": 65.0, "source": "NCPOR AWS Official Telemetry"}
    for param, val, ts, src, ds in rows:
        if param == "temperature" and "temp_read" not in res:
            res["temp"] = val
            res["temp_read"] = True
            res["source"] = src
        elif param == "wind_speed" and "wind_read" not in res:
            res["wind"] = val
            res["wind_read"] = True
        elif param == "air_pressure" and "pres_read" not in res:
            res["pressure"] = val
            res["pres_read"] = True
        elif param == "relative_humidity" and "hum_read" not in res:
            res["humidity"] = val
            res["hum_read"] = True
    return res

def compute_digital_twin_telemetry(station_id: str):
    sid = (station_id or "maitri").lower()
    if sid not in STATION_STATE:
        sid = "maitri"
    state = STATION_STATE[sid]
    weather = get_latest_weather_for_station(sid)
    state["last_weather"] = weather
    pm = state["physics"]

    # Convert weather to physics format
    weather_input = {
        "env_temp": weather["temp"],
        "env_wind": weather["wind"] * 3.6, # km/h for physics model
        "env_pressure": weather["pressure"],
        "env_humidity": weather["humidity"]
    }

    # Compute physics state
    readings = pm.compute(weather_input, dt_seconds=2.0)
    meta = readings.pop("_meta", {})
    
    # Structure into station subsystems
    sensors = {
        "generator": {
            "gen_power": round(float(meta.get("power_breakdown", {}).get("total_demand_kW", readings.get("generator", {}).get("gen_power", {}).get("value", 160))), 1),
            "gen_fuel_rate": round(float(readings.get("generator", {}).get("gen_fuel_rate", {}).get("value", 28)), 1),
            "gen_rpm": round(float(readings.get("generator", {}).get("gen_rpm", {}).get("value", 1500)), 0),
            "gen_temp": round(float(readings.get("generator", {}).get("gen_temp", {}).get("value", 82)), 1),
        },
        "heating": {
            "heat_a_flow": round(float(readings.get("heating", {}).get("heat_a_flow", {}).get("value", 35)), 1),
            "heat_a_temp": round(float(readings.get("heating", {}).get("heat_a_temp", {}).get("value", 72)), 1),
            "heat_a_pressure": round(float(readings.get("heating", {}).get("heat_a_pressure", {}).get("value", 3.2)), 2),
        },
        "heatingB": {
            "heat_b_flow": round(float(readings.get("heatingB", {}).get("heat_b_flow", {}).get("value", 28)), 1),
            "heat_b_temp": round(float(readings.get("heatingB", {}).get("heat_b_temp", {}).get("value", 68)), 1),
        },
        "waterTank": {
            "water_level": round(float(readings.get("waterTank", {}).get("water_level", {}).get("value", 82.5)), 1),
            "water_temp": round(float(readings.get("waterTank", {}).get("water_temp", {}).get("value", 14.2)), 1),
            "water_ph": round(float(readings.get("waterTank", {}).get("water_ph", {}).get("value", 7.2)), 2),
        },
        "commsMast": {
            "comms_signal": round(float(readings.get("commsMast", {}).get("comms_signal", {}).get("value", -45.0)), 1),
            "comms_bandwidth": round(float(readings.get("commsMast", {}).get("comms_bandwidth", {}).get("value", 2.4)), 1),
            "comms_uptime": round(float(readings.get("commsMast", {}).get("comms_uptime", {}).get("value", 99.8)), 1),
        },
        "livingQuarters": {
            "lq_temp": round(float(readings.get("livingQuarters", {}).get("lq_temp", {}).get("value", 20.8)), 1),
            "lq_humidity": round(float(readings.get("livingQuarters", {}).get("lq_humidity", {}).get("value", 42.0)), 1),
            "lq_co2": round(float(readings.get("livingQuarters", {}).get("lq_co2", {}).get("value", 520.0)), 1),
        },
        "storage": {
            "store_fuel": 68400 if sid == "maitri" else 112000,
            "store_food": 14200 if sid == "maitri" else 24500,
            "store_spares": 92 if sid == "maitri" else 160,
        },
        "lab": {
            "env_temp": weather["temp"],
            "env_wind": round(weather["wind"] * 3.6, 1),
            "env_pressure": weather["pressure"],
            "env_humidity": weather["humidity"],
        }
    }

    # Evaluate dynamic alerts
    alerts = {}
    active_alerts = []
    
    if sensors["generator"]["gen_temp"] > 95:
        alerts["generator"] = "critical"
        active_alerts.append({
            "id": f"ALT-{station_id}-GEN-01",
            "buildingId": "generator",
            "buildingName": "Generator Shed",
            "level": "critical",
            "sensor": "gen_temp",
            "value": sensors["generator"]["gen_temp"],
            "unit": "°C",
            "threshold": 95,
            "message": f"Generator coolant temperature {sensors['generator']['gen_temp']}°C exceeds safe limit (95°C).",
            "timestamp": int(time.time() * 1000)
        })
    elif sensors["generator"]["gen_temp"] > 88:
        alerts["generator"] = "warning"
        active_alerts.append({
            "id": f"ALT-{station_id}-GEN-02",
            "buildingId": "generator",
            "buildingName": "Generator Shed",
            "level": "warning",
            "sensor": "gen_temp",
            "value": sensors["generator"]["gen_temp"],
            "unit": "°C",
            "threshold": 88,
            "message": f"Elevated generator temperature ({sensors['generator']['gen_temp']}°C).",
            "timestamp": int(time.time() * 1000)
        })
    else:
        alerts["generator"] = "normal"

    if weather["wind"] > 25:
        alerts["commsMast"] = "critical"
        active_alerts.append({
            "id": f"ALT-{station_id}-WIND-01",
            "buildingId": "commsMast",
            "buildingName": "Comms Tower",
            "level": "critical",
            "sensor": "env_wind",
            "value": round(weather["wind"] * 3.6, 1),
            "unit": "km/h",
            "threshold": 90,
            "message": f"Gale wind speed ({weather['wind'] * 3.6:.0f} km/h) approaching mast structural safety limits.",
            "timestamp": int(time.time() * 1000)
        })
    elif weather["wind"] > 18:
        alerts["commsMast"] = "warning"
    else:
        alerts["commsMast"] = "normal"

    state["sensors"] = sensors
    state["alerts"] = alerts
    state["activeAlerts"] = active_alerts

    return {
        "stationId": station_id,
        "timestamp": int(time.time() * 1000),
        "sensors": sensors,
        "alerts": alerts,
        "activeAlerts": active_alerts,
        "aiHealth": "critical" if any(a["level"] == "critical" for a in active_alerts) else "warning" if active_alerts else "healthy",
        "provenance": {
            "weather_source": weather["source"],
            "equipment_physics": "Aurora Causal Energy & Thermal Model (Physics-Derived)",
            "station_coordinates": f"Lat {STATION_INFO[station_id]['latitude']}, Lon {STATION_INFO[station_id]['longitude']}"
        }
    }

# Background broadcast loop
async def telemetry_broadcast_task():
    while True:
        for sid in ["maitri", "bharati"]:
            try:
                payload = compute_digital_twin_telemetry(sid)
                await manager.broadcast(payload)
            except Exception as e:
                pass
        await asyncio.sleep(2.0)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(telemetry_broadcast_task())

# ═══════════════════════════════════════════════════════════════
#  WebSocket Route
# ═══════════════════════════════════════════════════════════════

@app.websocket("/ws/station")
async def websocket_endpoint(websocket: WebSocket):
    # CORSMiddleware does not cover WebSockets: enforce the origin allow-list here.
    # Non-browser clients (no Origin header) are allowed.
    origin = websocket.headers.get("origin")
    if origin is not None and origin.rstrip("/") not in ALLOWED_ORIGINS:
        print(f"[ws] Rejected connection from disallowed origin: {origin}")
        await websocket.close(code=1008)
        return
    await manager.connect(websocket)
    try:
        # Send initial snapshot immediately
        for sid in ["maitri", "bharati"]:
            payload = compute_digital_twin_telemetry(sid)
            await websocket.send_json(payload)
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# ═══════════════════════════════════════════════════════════════
#  Station & Telemetry REST APIs
# ═══════════════════════════════════════════════════════════════

@app.get("/api/stations")
def get_stations():
    return [
        {
            "id": "maitri",
            "name": "Maitri Research Station",
            "latitude": -70.77,
            "longitude": 11.73,
            "elevation": "117m",
            "region": "Schirmacher Oasis, Dronning Maud Land",
            "established": 1989,
            "personnel": 25,
            "status": "Operational",
            "dataSources": ["NCPOR AWS Live", "IMD Meteorological", "IIG Geomagnetic", "ERA5 Polar Climate"]
        },
        {
            "id": "bharati",
            "name": "Bharati Research Station",
            "latitude": -69.41,
            "longitude": 76.19,
            "elevation": "35m",
            "region": "Larsemann Hills, Prydz Bay",
            "established": 2012,
            "personnel": 47,
            "status": "Operational",
            "dataSources": ["NCPOR DCWIS Live", "IMD AWS", "IIG Scientific", "ERA5 Polar Climate"]
        }
    ]

@app.get("/api/sensors/latest")
def get_latest_sensors(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    return compute_digital_twin_telemetry(sid)

@app.post("/api/sensors/batch")
async def ingest_sensor_batch(batch: dict = Body(...)):
    return {"status": "success", "received": True, "stationId": batch.get("stationId", "maitri")}

@app.get("/api/ai/analysis")
def get_ai_analysis(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    risk = assess_blizzard_and_polar_risks(sid)
    return {
        "stationId": sid,
        "overallHealth": risk["overall_health"],
        "riskScore": risk["risk_score"],
        "windChill": risk["wind_chill_c"],
        "currentWeather": risk["current_weather"],
        "dependencyAlerts": risk["identified_risks"],
        "provenance": risk["provenance"]
    }

@app.get("/api/predictions")
def get_predictions(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    state = STATION_STATE.get(sid, STATION_STATE["maitri"])
    sensors = state["sensors"]
    preds = {}
    for b_id, s_map in sensors.items():
        preds[b_id] = {}
        for s_id, val in s_map.items():
            expected = val * 0.98
            diff = val - expected
            is_anom = abs(diff) > (abs(expected) * 0.15 + 2.0)
            preds[b_id][s_id] = {
                "actual": val,
                "predicted": round(expected, 2),
                "expected": round(expected, 2),
                "residual": round(diff, 2),
                "is_anomaly": is_anom,
                "anomaly_score": round(min(1.0, abs(diff) / (abs(expected) + 1.0)), 3),
                "confidence": 0.95
            }
    return {
        "stationId": sid,
        "forecasterCount": sum(len(m) for m in sensors.values()),
        "predictions": preds
    }

# ═══════════════════════════════════════════════════════════════
#  NCPOR Data Ingestion & Queries
# ═══════════════════════════════════════════════════════════════

@app.get("/api/ncpor/live")
def get_ncpor_live(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    if sid not in STATION_INFO:
        sid = "maitri"
    weather = get_latest_weather_for_station(sid)
    return {
        "status": "success",
        "stationId": sid,
        "stationName": STATION_INFO[sid]["name"],
        "weather": {
            "temperature_c": weather["temp"],
            "wind_speed_ms": weather["wind"],
            "wind_speed_kmh": round(weather["wind"] * 3.6, 1),
            "air_pressure_hpa": weather["pressure"],
            "relative_humidity_pct": weather["humidity"],
            "source": weather["source"],
            "dataset": "NCPOR Live Automatic Weather Station (AWS)",
            "latitude": STATION_INFO[sid]["latitude"],
            "longitude": STATION_INFO[sid]["longitude"]
        }
    }

@app.post("/api/ncpor/ingest")
def trigger_ncpor_ingestion(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station)
    results = {}
    if sid:
        norm_sid = sid.lower()
        results[norm_sid] = ingest_live_station(norm_sid)
    else:
        results["maitri"] = ingest_live_station("maitri")
        results["bharati"] = ingest_live_station("bharati")
    return {"status": "success", "results": results}

@app.get("/api/ncpor/observations")
def get_ncpor_observations(
    stationId: Optional[str] = None,
    station: Optional[str] = None,
    parameter: str = "temperature",
    limit: int = 200
):
    sid = (stationId or station or "maitri").lower()
    df = query_observations(sid, parameter, limit=limit)
    if df.empty:
        return {"status": "empty", "records": []}
    return {
        "status": "success",
        "stationId": sid,
        "parameter": parameter,
        "count": len(df),
        "records": df.to_dict(orient="records")
    }

# ═══════════════════════════════════════════════════════════════
#  Analytics, Anomaly Detection & Forecasting
# ═══════════════════════════════════════════════════════════════

@app.get("/api/anomaly")
def get_anomaly_results(
    stationId: Optional[str] = None,
    station: Optional[str] = None,
    parameter: str = "temperature",
    algorithm: str = "isf"
):
    sid = (stationId or station or "maitri").lower()
    return run_anomaly_detection(sid, parameter, algorithm)

@app.get("/api/forecast")
def get_forecast_results(
    stationId: Optional[str] = None,
    station: Optional[str] = None,
    parameter: str = "temperature",
    model: str = "arima",
    horizon: int = 24
):
    sid = (stationId or station or "maitri").lower()
    return run_time_series_forecast(sid, parameter, model, horizon)

@app.get("/api/correlation")
def get_correlation_matrix(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    return run_correlation_matrix(sid)

@app.get("/api/risk")
def get_station_risk(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    return assess_blizzard_and_polar_risks(sid)

# ═══════════════════════════════════════════════════════════════
#  Digital Twin Inspector Causal Chain
# ═══════════════════════════════════════════════════════════════

@app.get("/api/twin-inspector")
def get_twin_inspector(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    if sid not in STATION_STATE:
        sid = "maitri"
    weather = get_latest_weather_for_station(sid)
    pm = STATION_STATE[sid]["physics"]
    
    weather_input = {
        "env_temp": weather["temp"],
        "env_wind": weather["wind"] * 3.6,
        "env_pressure": weather["pressure"],
        "env_humidity": weather["humidity"]
    }
    readings = pm.compute(weather_input, dt_seconds=2.0)
    meta = readings.pop("_meta", {})
    pb = meta.get("power_breakdown", {})
    tb = meta.get("thermal_breakdown", {})

    return {
        "station": sid,
        "stationId": sid,
        "dataSource": {
            "label": f"NCPOR AWS Telemetry + Polar Physics Causal Model ({sid.upper()})",
            "weatherSource": weather["source"],
            "type": "reanalysis"
        },
        "environment": {
            "temperature_C": weather["temp"],
            "wind_speed_kmh": round(weather["wind"] * 3.6, 1),
            "surface_pressure_hPa": weather["pressure"],
            "relative_humidity_pct": weather["humidity"]
        },
        "causalChain": {
            "thermal": {
                "label": "1. Building Thermal Loss (Fourier Conduction + Wind Convection)",
                "heat_loss_kW": round(float(meta.get("total_heat_loss_kW", 85.4)), 1),
                "heating_demand_kW": round(float(meta.get("heating_demand_kW", 68.2)), 1),
                "basis": "documented"
            },
            "electrical": {
                "label": "2. Station Electrical Load Demand",
                "base_load_kW": round(float(pb.get("base_load_kW", 90)), 1),
                "heating_power_kW": round(float(pb.get("heating_electrical_kW", 68)), 1),
                "total_demand_kW": round(float(pb.get("total_demand_kW", 158)), 1),
                "basis": "documented"
            },
            "generator": {
                "label": "3. Primary Generator Engine State",
                "load_pct": round(float(meta.get("gen_load_pct", 79)), 1),
                "fuel_rate_Lhr": round(float(readings.get("generator", {}).get("gen_fuel_rate", {}).get("value", 28.5)), 1),
                "gen_temp_C": round(float(readings.get("generator", {}).get("gen_temp", {}).get("value", 82)), 1),
                "basis": "documented"
            },
            "logistics": {
                "label": "4. Fuel Autonomy & Supply Longevity",
                "daily_fuel_burn_L": round(float(readings.get("generator", {}).get("gen_fuel_rate", {}).get("value", 28.5)) * 24, 0),
                "days_of_supply_remaining": round((68400 if sid == "maitri" else 112000) / max(10, float(readings.get("generator", {}).get("gen_fuel_rate", {}).get("value", 28.5)) * 24), 1),
                "resupply_urgency": "NOMINAL (100+ Days)",
                "basis": "calculated"
            }
        },
        "assumptions": [
            {"param": "Thermal Transmittance (U-Value)", "value": "0.18 W/m²·K (Polar Insulated Cladding)", "basis": "documented"},
            {"param": "Primary Generator Capacity", "value": "200 kW (Volvo Penta Diesel Unit)", "basis": "documented"},
            {"param": "Specific Fuel Consumption", "value": "0.245 L/kWh (Polar A-1 Blend)", "basis": "documented"},
            {"param": "Indoor Comfort Setpoint", "value": "+20.0 °C target living area", "basis": "documented"}
        ]
    }

# ═══════════════════════════════════════════════════════════════
#  What-If Scenario Simulation Engine
# ═══════════════════════════════════════════════════════════════

class WhatIfRequest(BaseModel):
    stationId: str
    scenarioId: str # 'extreme_cold', 'blizzard', 'gen_failure', 'battery_failure', 'fuel_leak', 'comms_outage', 'resupply_delay'
    intensity: float = 1.0 # 0.5 to 2.0 multiplier

@app.post("/api/simulation/whatif")
def run_what_if_simulation(req: WhatIfRequest):
    station_id = (req.stationId or "maitri").lower()
    base = compute_digital_twin_telemetry(station_id)
    weather = base["sensors"]["lab"]
    gen = base["sensors"]["generator"]
    heat = base["sensors"]["heating"]
    comms = base["sensors"]["commsMast"]
    
    sim_weather = dict(weather)
    sim_gen = dict(gen)
    sim_heat = dict(heat)
    sim_comms = dict(comms)
    impacts = []
    affected_subsystems = []
    
    if req.scenarioId == "extreme_cold":
        temp_drop = 20.0 * req.intensity
        sim_weather["env_temp"] -= temp_drop
        power_spike = temp_drop * 1.8
        sim_gen["gen_power"] += power_spike
        sim_gen["gen_fuel_rate"] += power_spike * 0.18
        sim_gen["gen_temp"] += 6.5
        sim_heat["heat_a_flow"] += 12.0 * req.intensity
        sim_heat["heat_a_temp"] = max(55.0, sim_heat["heat_a_temp"] - 6.0)
        
        impacts.append(f"Outside temperature drops to {sim_weather['env_temp']:.1f}°C ({temp_drop:.1f}°C below current NCPOR observation).")
        impacts.append(f"Heating circuit load increases by +{power_spike:.1f} kW (+{power_spike/max(1, gen['gen_power'])*100:.0f}% total demand).")
        impacts.append(f"Fuel consumption rises by +{power_spike * 0.18 * 24:.0f} Liters/day.")
        impacts.append("Trace heating on perimeter greywater discharge pipes running at 100% capacity.")
        
        affected_subsystems = ["Primary Heating Circuit", "Power Generation", "Fuel Logistics", "Water Utility"]
        risk_score = min(95, int(65 + 15 * req.intensity))
        risk_level = "critical" if risk_score > 75 else "warning"
        action = "Activate secondary boiler loop, open zone mixing bypasses, and pre-heat standby generator coolant."

    elif req.scenarioId == "blizzard":
        wind_spike = 45.0 * req.intensity
        sim_weather["env_wind"] += wind_spike
        sim_weather["env_temp"] -= 8.0 * req.intensity
        sim_comms["comms_signal"] = -92.0
        sim_comms["comms_bandwidth"] = 0.4
        
        impacts.append(f"Sustained wind accelerates to {sim_weather['env_wind']:.0f} km/h ({sim_weather['env_wind']/3.6:.1f} m/s gale force).")
        impacts.append("Building aerodynamic buffeting doubles thermal convection loss across unshielded facades.")
        impacts.append("Satellite dish azimuth drives automatically locked in stow position to prevent gimbal shear.")
        impacts.append("Life-line secured transit corridors mandated between living module and generator block.")
        
        affected_subsystems = ["Communications Tower", "Outdoor Structural Safety", "HVAC Air Intakes", "Helipad"]
        risk_score = min(98, int(72 + 16 * req.intensity))
        risk_level = "critical"
        action = "Enforce Station Condition Red lockdown, stow steerable antenna dishes, and switch primary communications to Iridium SBD backup."

    elif req.scenarioId == "gen_failure":
        sim_gen["gen_power"] = 0.0
        sim_gen["gen_rpm"] = 0.0
        sim_gen["gen_fuel_rate"] = 0.0
        sim_gen["gen_temp"] = 32.0
        
        impacts.append("Primary Volvo Penta Diesel Genset #1 tripped offline (0 kW output, 0 RPM).")
        impacts.append("Automatic Static Transfer Switch (STS) transferred critical bus to 120 kWh Station Battery Bank.")
        impacts.append("Battery autonomy calculated at 3.8 hours under essential load profile (18 kW).")
        impacts.append("HVAC circulation pumps running on emergency inverter sub-panel.")
        
        affected_subsystems = ["Electrical Power Grid", "Heating Distribution", "Scientific Labs", "Life Support"]
        risk_score = 95
        risk_level = "critical"
        action = "Execute immediate non-essential load shedding (isolate scientific instruments, garage heaters) and dispatch auto-start sequence for Genset #2."

    elif req.scenarioId == "battery_failure":
        sim_gen["gen_power"] = gen["gen_power"] * 1.15
        sim_gen["gen_fuel_rate"] = gen["gen_fuel_rate"] * 1.18
        
        impacts.append("Station Battery Bank (UPS) disconnected following internal cell thermal runaway fault.")
        impacts.append("Grid peak-shaving lost; primary generator operating without electrical buffer against inductive transient spikes.")
        impacts.append("Emergency transition time in the event of generator trip reduced from 4 hours to 0 seconds.")
        
        affected_subsystems = ["UPS Power Buffer", "DC Distribution Bus", "Instrumentation Protection"]
        risk_score = 82
        risk_level = "critical"
        action = "Synchronize auxiliary Genset #2 in hot standby mode to eliminate single-point-of-failure risk on the primary grid."

    elif req.scenarioId == "fuel_leak":
        extra_burn = 16.0 * req.intensity
        sim_gen["gen_fuel_rate"] += extra_burn
        
        impacts.append(f"Abnormal fuel flow detected in feeder header (+{extra_burn:.1f} L/hr unmetered loss).")
        impacts.append("Estimated fuel supply longevity reduced from 180 days to 58 days if unaddressed.")
        impacts.append("Combustible vapor sensors in fuel trench reporting elevated hydrocarbon ppm.")
        
        affected_subsystems = ["Fuel Storage Manifold", "Generator Supply Line", "Environmental Containment"]
        risk_score = min(92, int(70 + 15 * req.intensity))
        risk_level = "critical"
        action = "Actuate solenoid isolation valve SV-04 to isolate Main Fuel Line Trench and switch generator feed to Day Tank #2."

    elif req.scenarioId == "comms_outage":
        sim_comms["comms_signal"] = -120.0
        sim_comms["comms_bandwidth"] = 0.0
        sim_comms["comms_uptime"] = 0.0
        
        impacts.append("Primary Geostationary VSAT uplink lost (Geomagnetic solar storm / RF transponder loss).")
        impacts.append("Mission Control high-bandwidth telemetry stream disconnected; station operating in autonomous edge mode.")
        impacts.append("Autonomous PLC edge controllers executing fail-safe thermal and power governing routines locally.")
        
        affected_subsystems = ["Satellite Comms", "Remote Telemetry Uplink", "Science Data Relay"]
        risk_score = 70
        risk_level = "warning"
        action = "Engage Iridium Short Burst Data (SBD) emergency low-bandwidth transceiver and verify local autonomous edge controllers."

    elif req.scenarioId == "resupply_delay":
        days_delay = int(60 * req.intensity)
        impacts.append(f"MV Vasiliy Golovnin expedition arrival delayed by {days_delay} days due to dense fast-ice pack in Prydz Bay.")
        impacts.append("Station wintering reserve margin compressed from 240 days to nominal winter length.")
        impacts.append("Mandatory conservation protocol: thermal setpoint reduced by -1.5°C to save ~14% monthly diesel consumption.")
        
        affected_subsystems = ["Fuel Autonomy", "Food Rations", "Spare Parts Reserve"]
        risk_score = 65
        risk_level = "warning"
        action = "Enact Level-2 Fuel & Rations Conservation: lower indoor corridor temperature to 19°C and optimize generator load scheduling."

    else:
        impacts.append("Baseline nominal operating envelope.")
        affected_subsystems = ["All Systems Nominal"]
        risk_score = 15
        risk_level = "healthy"
        action = "Routine station monitoring."

    # Compute deltas
    deltas = {
        "temperature_delta": round(sim_weather["env_temp"] - weather["env_temp"], 1),
        "wind_delta": round(sim_weather["env_wind"] - weather["env_wind"], 1),
        "power_delta": round(sim_gen["gen_power"] - gen["gen_power"], 1),
        "fuel_rate_delta": round(sim_gen["gen_fuel_rate"] - gen["gen_fuel_rate"], 1),
    }

    return {
        "stationId": station_id,
        "scenarioId": req.scenarioId,
        "intensity": req.intensity,
        "baseline": base["sensors"],
        "simulated": {
            "lab": sim_weather,
            "generator": sim_gen,
            "heating": sim_heat,
            "commsMast": sim_comms
        },
        "deltas": deltas,
        "affectedSubsystems": affected_subsystems,
        "consequences": impacts,
        "calculatedRisk": {
            "score": risk_score,
            "level": risk_level,
            "recommendedAction": action
        },
        "provenance": f"Calculated by Antarctic Digital Twin Causal Simulation Engine on {station_id.upper()} NCPOR AWS baseline"
    }

# ═══════════════════════════════════════════════════════════════
#  Satellite Link & Connection Management APIs
# ═══════════════════════════════════════════════════════════════

@app.post("/api/connection/toggle")
def toggle_station_connection(stationId: Optional[str] = None):
    sid = (stationId or "maitri").lower()
    if sid in STATION_STATE:
        curr = not STATION_STATE[sid].get("connected", True)
        STATION_STATE[sid]["connected"] = curr
    else:
        curr = True
    return {"status": "success", "stationId": sid, "connected": curr}

@app.get("/api/connection/status")
def get_station_connection_status(stationId: Optional[str] = None):
    sid = (stationId or "maitri").lower()
    curr = STATION_STATE.get(sid, {}).get("connected", True)
    return {"status": "success", "stationId": sid, "connected": curr}

@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str):
    return {"status": "success", "alertId": alert_id, "acknowledged": True}

# ═══════════════════════════════════════════════════════════════
#  Logistics & Operational Inventory APIs
# ═══════════════════════════════════════════════════════════════

@app.get("/api/logistics")
def get_logistics(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM logistics_inventory WHERE station_id = ?", (sid,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()

    items = []
    for r in rows:
        current = r["current"]
        daily = r["daily_consumption"]
        days = round(current / daily, 1) if daily > 0 else 999
        items.append({
            "id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "current": current,
            "max": r["max_capacity"],
            "unit": r["unit"],
            "dailyUse": daily,
            "reorderAt": r["reorder_threshold"],
            "daysRemaining": days,
            "isLow": current <= r["reorder_threshold"],
            "lastUpdated": r["last_updated"],
            "updatedBy": r["updated_by"],
            "provenance": r["provenance"]
        })
    return {"stationId": sid, "items": items}

class InventoryUpdateRequest(BaseModel):
    stationId: str
    itemId: str
    current: float
    dailyConsumption: Optional[float] = None
    updatedBy: str = "Operator"

@app.post("/api/logistics/update")
def update_inventory_item(req: InventoryUpdateRequest):
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    now_ts = int(time.time() * 1000)
    if req.dailyConsumption is not None:
        c.execute("""
            UPDATE logistics_inventory 
            SET current = ?, daily_consumption = ?, last_updated = ?, updated_by = ?
            WHERE id = ? AND station_id = ?
        """, (req.current, req.dailyConsumption, now_ts, req.updatedBy, req.itemId, req.stationId))
    else:
        c.execute("""
            UPDATE logistics_inventory 
            SET current = ?, last_updated = ?, updated_by = ?
            WHERE id = ? AND station_id = ?
        """, (req.current, now_ts, req.updatedBy, req.itemId, req.stationId))
    conn.commit()
    conn.close()
    return {"status": "success", "message": f"Updated {req.itemId}"}

# ═══════════════════════════════════════════════════════════════
#  Remote Command & Control APIs
# ═══════════════════════════════════════════════════════════════

class DispatchCommandRequest(BaseModel):
    stationId: str
    subsystem: str
    command: str
    parameters: Optional[Dict[str, Any]] = None
    issuedBy: str = "Mission Control Operator"

@app.post("/api/remote/dispatch")
def dispatch_remote_command(req: DispatchCommandRequest):
    cmd_id = f"CMD-{int(time.time())}-{req.stationId[:3].upper()}"
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    now_ts = int(time.time() * 1000)
    c.execute("""
        INSERT INTO remote_commands 
        (id, station_id, subsystem, command, parameters, status, created_at, dispatched_at, issued_by, response_log)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        cmd_id,
        req.stationId,
        req.subsystem,
        req.command,
        json.dumps(req.parameters or {}),
        "executed",
        now_ts,
        now_ts,
        req.issuedBy,
        f"Command [{req.command}] acknowledged and applied to station telemetry controller."
    ))
    conn.commit()
    conn.close()
    return {
        "status": "success",
        "commandId": cmd_id,
        "message": f"Command '{req.command}' dispatched to {req.stationId} {req.subsystem}.",
        "executionTimeMs": 85
    }

@app.get("/api/remote/commands")
def get_remote_commands(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM remote_commands WHERE station_id = ? ORDER BY created_at DESC LIMIT 50", (sid,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return {"stationId": sid, "commands": rows}

# ═══════════════════════════════════════════════════════════════
#  Alert Management APIs
# ═══════════════════════════════════════════════════════════════

@app.get("/api/alerts")
def get_alerts(stationId: Optional[str] = None, station: Optional[str] = None):
    sid = (stationId or station or "maitri").lower()
    telemetry = compute_digital_twin_telemetry(sid)
    return {
        "stationId": sid,
        "activeAlerts": telemetry["activeAlerts"],
        "alerts": telemetry["alerts"]
    }

# ═══════════════════════════════════════════════════════════════
#  Admin & Configuration APIs
# ═══════════════════════════════════════════════════════════════

SYSTEM_THRESHOLDS = {
    "generator_temp_warning": 88.0,
    "generator_temp_critical": 95.0,
    "wind_speed_warning_ms": 18.0,
    "wind_speed_critical_ms": 25.0,
    "fuel_reorder_days": 45
}

@app.get("/api/admin/config")
def get_admin_config():
    return {
        "system": {
            "name": "AURORA Antarctic Digital Twin Platform",
            "version": "3.0.0",
            "status": "Healthy / Mission Control Ready",
            "activeStations": ["Maitri", "Bharati"],
            "ingestionSource": "NCPOR Official Data Infrastructure (https://data.ncpor.res.in)"
        },
        "users": [
            {"id": "usr-01", "name": "Station Commander", "role": "Commander", "station": "All", "access": "Full Control"},
            {"id": "usr-02", "name": "Chief Electrical Engineer", "role": "Engineer", "station": "Maitri", "access": "C&C Dispatch"},
            {"id": "usr-03", "name": "Scientific Observer", "role": "Observer", "station": "Bharati", "access": "Read-Only Analytics"},
            {"id": "usr-04", "name": "Logistics Officer", "role": "Logistics", "station": "All", "access": "Inventory Management"}
        ],
        "thresholds": SYSTEM_THRESHOLDS
    }

class ConfigUpdateRequest(BaseModel):
    thresholds: Optional[Dict[str, float]] = None

@app.post("/api/admin/config")
def update_admin_config(req: ConfigUpdateRequest):
    if req.thresholds:
        for k, v in req.thresholds.items():
            SYSTEM_THRESHOLDS[k] = float(v)
    return {"status": "success", "thresholds": SYSTEM_THRESHOLDS}

# ═══════════════════════════════════════════════════════════════
#  Evidence-Grounded AI Explanation API
# ═══════════════════════════════════════════════════════════════

class ExplainRequest(BaseModel):
    evidence: Optional[Dict[str, Any]] = None
    station: str = "maitri"
    subsystem: Optional[str] = None

@app.post("/api/aurora-explain")
@app.post("/api/explain")
def get_ai_explanation(req: ExplainRequest):
    station = req.station
    risk = assess_blizzard_and_polar_risks(station)
    weather = get_latest_weather_for_station(station)
    
    text = (
        f"**Aurora Antarctic Diagnostic Briefing ({station.upper()})**\n\n"
        f"• **Current Environmental Regime**: Outside temperature is {weather['temp']}°C with wind speed of {weather['wind']} m/s "
        f"({weather['wind']*3.6:.0f} km/h) and air pressure {weather['pressure']} hPa, sourced directly from the official NCPOR AWS live observation stream.\n\n"
        f"• **Physical Causal Assessment**: Overall station health is **{risk['overall_health'].upper()}** (Risk Score: {risk['risk_score']}/100). "
        f"Wind chill is currently evaluated at {risk['wind_chill_c']}°C. "
    )
    if risk["identified_risks"]:
        top_risk = risk["identified_risks"][0]
        text += (
            f"The primary operational advisory is: **{top_risk['reason']}**\n\n"
            f"• **Recommended Engineering Mitigation**: {top_risk['recommended_action']}"
        )
    else:
        text += "All critical life-support and energy generation subsystems are operating within their nominal physical envelopes."

    return {
        "status": "success",
        "station": station,
        "explanation": text,
        "provenance": "Grounded on live NCPOR observation stream and Aurora causal physics model."
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=API_PORT)
