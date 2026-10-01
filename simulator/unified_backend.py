"""
Aurora & NCPOR Antarctic Digital Twin — Unified Mission Control Backend
THE single public backend (see CLAUDE.md). Runs FastAPI + Uvicorn + WebSockets
on API_PORT (default 8080). All settings come from config.py (root .env).

Telemetry pipeline (PROJECT_CONTEXT.md B1/B2 fix):
- simulator.py (:8001, internal) POSTs /api/sensors/batch every tick.
- A background tick (the ONLY code that advances physics state) runs every
  TICK_INTERVAL_S: it advances the physics-fallback model per station, then
  publishes either the fresh simulator batch (dataSource="simulator") or the
  physics fallback (dataSource="physics-fallback") and broadcasts it on the WS.
- Every GET / WS read returns the last *published* snapshot — reads never
  mutate twin state.

Also serves NCPOR data APIs, analytics (ISF/SVM, ARIMA), risk engine, twin
inspector, what-if, logistics, remote commands and admin config.
"""

import asyncio
import json
import logging
import re
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import requests
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

# Import digital twin engines
sys.path.insert(0, str(Path(__file__).parent))
import alert_engine
import config as app_config
import db
import station_config
from alert_engine import AlertEngine, AlertNotFound
from analytics_ai_engine import (
    assess_blizzard_and_polar_risks,
    query_observations,
    run_anomaly_detection,
    run_correlation_matrix,
    run_time_series_forecast,
)
from cascade import analyze_dependency_cascade
from ncpor_ingestor import ingest_live_station, init_db
from offline_explain import offline_explanation
from physics_model import StationPhysicsModel
from station_store import StationStore
from twin_inspector import build_twin_inspector
from units import kmh_to_ms, ms_to_kmh
from validation import Identifier, OperatorName, StationIdStr

log = logging.getLogger("aurora.backend")

STATIONS = station_config.station_ids()          # from station_config.json

# Physics-fallback models. ONLY advance_fallback() (called by the tick) may
# call .compute() on these — compute() mutates fuel/temps/water state.
PHYSICS = {sid: StationPhysicsModel(sid) for sid in STATIONS}

store = StationStore(STATIONS, history_max_points=app_config.HISTORY_MAX_POINTS)
# Persistent threshold alerts for every sensor (station_config defaults + admin overrides).
ALERTS = AlertEngine(STATIONS, resolve_ticks=app_config.ALERT_RESOLVE_TICKS)


# ═══════════════════════════════════════════════════════════════
#  Station validation (shared by every route)
# ═══════════════════════════════════════════════════════════════

def require_station(raw) -> str:
    """Normalise a station id; unknown → 404 with a clear message."""
    sid = str(raw).strip().lower() if raw is not None else ""
    if sid not in STATIONS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown station '{raw}'. Valid stations: {', '.join(STATIONS)}",
        )
    return sid


def station_param(stationId: str | None = Query(None), station: str | None = Query(None)) -> str:
    """Query-string station dependency. Missing → 'maitri' (backward compatible)."""
    raw = stationId if stationId is not None else station
    return require_station("maitri" if raw is None else raw)


def optional_station_param(stationId: str | None = Query(None), station: str | None = Query(None)) -> str | None:
    """Like station_param, but missing means 'all stations' (None)."""
    raw = stationId if stationId is not None else station
    return None if raw is None else require_station(raw)


# ═══════════════════════════════════════════════════════════════
#  WebSocket Connection Manager (per-station subscriptions)
# ═══════════════════════════════════════════════════════════════

class ConnectionManager:
    """All methods run on the event loop, so the dict needs no lock."""

    def __init__(self):
        self._conns: dict[WebSocket, str | None] = {}

    async def connect(self, websocket: WebSocket, station_filter: str | None):
        await websocket.accept()
        self._conns[websocket] = station_filter

    def disconnect(self, websocket: WebSocket):
        self._conns.pop(websocket, None)

    async def broadcast(self, sid: str, message: dict):
        for ws, station_filter in list(self._conns.items()):
            if station_filter is not None and station_filter != sid:
                continue
            try:
                await ws.send_json(message)
            except Exception as exc:
                log.info("WS send failed (%s); dropping client", exc)
                self.disconnect(ws)

manager = ConnectionManager()


# ═══════════════════════════════════════════════════════════════
#  Weather input (read-only DB access)
# ═══════════════════════════════════════════════════════════════

def get_latest_weather_for_station(station_id: str):
    with db.connect() as conn:
        rows = conn.execute("""
            SELECT parameter, value, timestamp, source, dataset
            FROM observations
            WHERE station_id = ?
            ORDER BY timestamp DESC LIMIT 30
        """, (station_id,)).fetchall()

    res = {"temp": -15.0, "wind": 12.0, "pressure": 985.0, "humidity": 65.0,
           "source": "built-in default (no observations in DB)", "dataset": None}
    for param, val, _ts, src, ds in rows:
        if param == "temperature" and "temp_read" not in res:
            res["temp"] = val
            res["temp_read"] = True
            res["source"] = src
            res["dataset"] = ds
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


def _weather_provenance(weather: dict) -> str:
    ds = weather.get("dataset")
    if ds == "NCPOR-AWS-Live":
        return "REAL"
    if ds is None:
        return "HARDCODED-DEMO"
    return "REANALYSIS"


# ═══════════════════════════════════════════════════════════════
#  ADVANCE STATE (mutating) — called only by the background tick
# ═══════════════════════════════════════════════════════════════

def _val(readings: dict, bld: str, sensor: str, default: float) -> float:
    return float(readings.get(bld, {}).get(sensor, {}).get("value", default))


def advance_fallback(sid: str) -> dict:
    """Advance the physics-fallback model by one tick from the latest DB weather.
    This is the ONLY place pm.compute() is called. Returns raw physics output."""
    weather = get_latest_weather_for_station(sid)
    weather_input = {
        "env_temp": weather["temp"],
        "env_wind": ms_to_kmh(weather["wind"]),  # DB stores m/s; physics model takes km/h
        "env_pressure": weather["pressure"],
        "env_humidity": weather["humidity"],
    }
    readings = PHYSICS[sid].compute(weather_input, dt_seconds=app_config.TICK_INTERVAL_S)
    meta = readings.pop("_meta", {})

    sensors = {
        "generator": {
            "gen_power": round(float(meta.get("power_breakdown", {}).get(
                "total_demand_kW", _val(readings, "generator", "gen_power", 160))), 1),
            "gen_fuel_rate": round(_val(readings, "generator", "gen_fuel_rate", 28), 1),
            "gen_rpm": round(_val(readings, "generator", "gen_rpm", 1500), 0),
            "gen_temp": round(_val(readings, "generator", "gen_temp", 82), 1),
        },
        "heating": {
            "heat_a_flow": round(_val(readings, "heating", "heat_a_flow", 35), 1),
            "heat_a_temp": round(_val(readings, "heating", "heat_a_temp", 72), 1),
            "heat_a_pressure": round(_val(readings, "heating", "heat_a_pressure", 3.2), 2),
        },
        "heatingB": {
            "heat_b_flow": round(_val(readings, "heatingB", "heat_b_flow", 28), 1),
            "heat_b_temp": round(_val(readings, "heatingB", "heat_b_temp", 68), 1),
        },
        "waterTank": {
            "water_level": round(_val(readings, "waterTank", "water_level", 82.5), 1),
            "water_temp": round(_val(readings, "waterTank", "water_temp", 14.2), 1),
            "water_ph": round(_val(readings, "waterTank", "water_ph", 7.2), 2),
        },
        "commsMast": {
            "comms_signal": round(_val(readings, "commsMast", "comms_signal", -45.0), 1),
            "comms_bandwidth": round(_val(readings, "commsMast", "comms_bandwidth", 2.4), 1),
            "comms_uptime": round(_val(readings, "commsMast", "comms_uptime", 99.8), 1),
        },
        "livingQuarters": {
            "lq_temp": round(_val(readings, "livingQuarters", "lq_temp", 20.8), 1),
            "lq_humidity": round(_val(readings, "livingQuarters", "lq_humidity", 42.0), 1),
            "lq_co2": round(_val(readings, "livingQuarters", "lq_co2", 520.0), 1),
        },
        # Storage from the physics model's running state. Unit convention
        # (CLAUDE.md): store_fuel kL, store_food days, store_spares items.
        "storage": {
            "store_fuel": round(_val(readings, "storage", "store_fuel", 0.0), 2),
            "store_food": round(_val(readings, "storage", "store_food", 0.0), 1),
            "store_spares": round(_val(readings, "storage", "store_spares", 0.0), 0),
        },
        "lab": {
            "env_temp": weather["temp"],
            "env_wind": round(ms_to_kmh(weather["wind"]), 1),   # km/h
            "env_pressure": weather["pressure"],
            "env_humidity": weather["humidity"],
        },
    }
    return {
        "sensors": sensors,
        "meta": meta,
        "readings": readings,
        "weather": weather,
        "computedAt": int(time.time() * 1000),
    }


# ═══════════════════════════════════════════════════════════════
#  COMPUTE SNAPSHOT (pure) — no IO, no mutation
# ═══════════════════════════════════════════════════════════════

def build_snapshot(sid: str, sensors: dict, *, source: str, provenance: dict, ts_ms: int,
                   last_batch_age, connected: bool, event_timeline=None, active_patterns=None) -> dict:
    """sensors → persistent threshold alerts (ALERTS.evaluate) → cascade → health → snapshot.
    Only the tick calls this (via select_snapshot), so alert state advances once per tick."""
    alerts, active_alerts = ALERTS.evaluate(sid, sensors, ts_ms)
    dependency_alerts = analyze_dependency_cascade(alerts, sid)
    if (any(a["level"] == "critical" for a in active_alerts)
            or any(d["severity"] == "critical" for d in dependency_alerts)):
        health = "critical"
    elif active_alerts or dependency_alerts:
        health = "warning"
    else:
        health = "healthy"
    return {
        "stationId": sid,
        "timestamp": ts_ms,
        "dataSource": source,
        "provenance": provenance,
        "lastBatchAgeSec": None if last_batch_age is None else round(last_batch_age, 1),
        "sensors": sensors,
        "alerts": alerts,
        "activeAlerts": active_alerts,
        "dependencyAlerts": dependency_alerts,
        "aiHealth": health,
        "eventTimeline": list(event_timeline or []),
        "activePatterns": list(active_patterns or []),
        "connected": connected,
    }


def _coords(sid: str) -> str:
    c = station_config.coords(sid)
    return f"Lat {c['lat']}, Lon {c['lon']}"


def snapshot_from_fallback(sid: str, fallback: dict, last_batch_age) -> dict:
    weather = fallback["weather"]
    provenance = {
        "equipment": "MODEL-DERIVED",
        "environment": _weather_provenance(weather),
        "storage": "MODEL-DERIVED",
        "injectedSensors": [],
        "activeScenario": None,
        "weatherSource": weather.get("source"),
        "equipmentModel": "Aurora causal energy & thermal model (physics fallback in backend)",
        "stationCoordinates": _coords(sid),
    }
    return build_snapshot(
        sid, fallback["sensors"], source="physics-fallback", provenance=provenance,
        ts_ms=fallback["computedAt"], last_batch_age=last_batch_age,
        connected=store.is_connected(sid),
    )


def snapshot_from_batch(sid: str, batch: dict, last_batch_age) -> dict:
    sensors = {
        bld: {sensor: reading["value"] for sensor, reading in readings.items()}
        for bld, readings in batch["readings"].items()
    }
    injected = list(batch.get("injectedSensors") or [])
    mode = batch.get("mode") or "reanalysis"
    simulated_mode = mode == "simulation"
    equipment_injected = any(not k.startswith("lab.") for k in injected)
    env_injected = any(k.startswith("lab.") for k in injected)
    provenance = {
        "equipment": "SIMULATED" if (simulated_mode or equipment_injected) else "MODEL-DERIVED",
        "environment": "SIMULATED" if (simulated_mode or env_injected) else "REANALYSIS",
        "storage": "SIMULATED" if simulated_mode else "MODEL-DERIVED",
        "injectedSensors": injected,
        "activeScenario": batch.get("activeScenario"),
        "weatherSource": batch.get("weatherSource"),
        "equipmentModel": ("random-walk simulation (simulator.py)" if simulated_mode
                           else "Aurora physics model (simulator.py)"),
        "stationCoordinates": _coords(sid),
    }
    return build_snapshot(
        sid, sensors, source="simulator", provenance=provenance,
        ts_ms=batch.get("timestamp") or int(time.time() * 1000),
        last_batch_age=last_batch_age, connected=store.is_connected(sid),
        event_timeline=batch.get("eventTimeline"), active_patterns=batch.get("activePatterns"),
    )


def select_snapshot(sid: str) -> dict:
    """Simulator batch if fresh (≤ SIM_BATCH_FRESH_S), else physics fallback."""
    age = store.batch_age(sid)
    batch = store.latest_batch(sid)
    if batch is not None and age is not None and age <= app_config.SIM_BATCH_FRESH_S:
        return snapshot_from_batch(sid, batch, age)
    return snapshot_from_fallback(sid, store.get_fallback(sid), age)


def published_snapshot(sid: str) -> dict:
    snap = store.get_published(sid)
    if snap is None:
        raise HTTPException(status_code=503, detail="Telemetry not ready yet; retry shortly")
    return snap


# ═══════════════════════════════════════════════════════════════
#  Background tick (the only writer of physics state)
# ═══════════════════════════════════════════════════════════════

def tick_station(sid: str) -> dict:
    """One station tick (blocking: physics + alert DB writes). Runs in a worker thread."""
    fallback = advance_fallback(sid)
    store.set_fallback(sid, fallback)
    snap = select_snapshot(sid)
    store.publish(sid, snap)
    return snap


async def run_tick():
    for sid in STATIONS:
        try:
            snap = await asyncio.to_thread(tick_station, sid)
            await manager.broadcast(sid, snap)
        except Exception:
            log.exception("Tick failed for station %s", sid)
    try:
        promoted = await asyncio.to_thread(promote_remote_commands)
        if promoted:
            log.info("Simulated remote commands acknowledged: %d", promoted)
    except Exception:
        log.exception("Remote-command lifecycle step failed")


async def tick_loop():
    while True:
        await asyncio.sleep(app_config.TICK_INTERVAL_S)
        await run_tick()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    ALERTS.load_open()   # open/acknowledged alerts survive restarts
    await run_tick()   # prime: every station has a published snapshot before serving
    task = asyncio.create_task(tick_loop())
    log.info("Unified backend ready (v%s, tick %.1fs, batch freshness %.0fs)",
             app_config.APP_VERSION, app_config.TICK_INTERVAL_S, app_config.SIM_BATCH_FRESH_S)
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            log.debug("Tick loop stopped on shutdown")


app = FastAPI(title="Aurora Antarctic Digital Twin Platform", version=app_config.APP_VERSION, lifespan=lifespan)

@app.exception_handler(RequestValidationError)
async def _validation_error_handler(request: Request, exc: RequestValidationError):
    """422 with JSON-safe details. FastAPI's default echoes the raw input, which
    crashes (500) when a body contains NaN/Infinity."""
    errors = []
    for e in exc.errors():
        item = {k: v for k, v in e.items() if k not in ("input", "ctx", "url")}
        if "ctx" in e:
            item["ctx"] = {k: str(v) for k, v in e["ctx"].items()}
        errors.append(item)
    log.info("422 on %s %s: %s", request.method, request.url.path, [x.get("msg") for x in errors][:5])
    return JSONResponse(status_code=422, content={"detail": errors})


app.add_middleware(
    CORSMiddleware,
    allow_origins=app_config.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# ═══════════════════════════════════════════════════════════════
#  WebSocket Route
# ═══════════════════════════════════════════════════════════════

@app.websocket("/ws/station")
async def websocket_endpoint(websocket: WebSocket):
    # CORSMiddleware does not cover WebSockets: enforce the origin allow-list here.
    # Non-browser clients (no Origin header) are allowed.
    origin = websocket.headers.get("origin")
    if origin is not None and origin.rstrip("/") not in app_config.ALLOWED_ORIGINS:
        log.warning("WS rejected: disallowed origin %s", origin)
        await websocket.close(code=1008)
        return
    raw = websocket.query_params.get("stationId")
    station_filter = None
    if raw is not None:
        station_filter = raw.strip().lower()
        if station_filter not in STATIONS:
            log.warning("WS rejected: unknown stationId %r", raw)
            await websocket.close(code=1008)
            return
    await manager.connect(websocket, station_filter)
    try:
        # Initial snapshot(s) from the published cache — no computation.
        for sid in ([station_filter] if station_filter else STATIONS):
            snap = store.get_published(sid)
            if snap is not None:
                await websocket.send_json(snap)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        log.debug("WS client disconnected (filter=%s)", station_filter)
    except Exception:
        log.warning("WS connection error", exc_info=True)
    finally:
        manager.disconnect(websocket)


# ═══════════════════════════════════════════════════════════════
#  Station & Telemetry REST APIs
# ═══════════════════════════════════════════════════════════════

@app.get("/api/stations")
def get_stations():
    """Station list (plain values) derived from station_config.json."""
    out = []
    for sid in STATIONS:
        m = station_config.metadata_values(sid)
        out.append({
            "id": sid,
            "name": m["fullName"],
            "shortName": m["name"],
            "latitude": m["latitude"],
            "longitude": m["longitude"],
            "elevation_m": m["elevation_m"],
            "region": m["region"],
            "established": m["commissionedYear"],
            "personnelWinter": m.get("personnelWinter"),
            "dataSources": ["ERA5 reanalysis (Open-Meteo)", "NCPOR AWS live page (manual ingest)"],
        })
    return out


@app.get("/api/config/stations")
def get_station_config():
    """The full station configuration (metadata with source/confidence notes,
    buildings, dependency graph, default thresholds, remote-command catalogue)."""
    return station_config.load()


@app.get("/api/sensors/latest")
def get_latest_sensors(sid: str = Depends(station_param)):
    return published_snapshot(sid)


@app.get("/api/station/{station_id}/state")
def get_station_state(station_id: str):
    return published_snapshot(require_station(station_id))


# ── Simulator ingest ──────────────────────────────────────────

class SensorValue(BaseModel):
    value: float = Field(allow_inf_nan=False)
    unit: str = Field("", max_length=16)
    sourceType: str | None = Field(None, max_length=32)


class SensorBatch(BaseModel):
    """Superset of the legacy Java SensorBatchDTO (new fields are optional)."""
    stationId: str = Field(max_length=32)
    timestamp: int | None = None
    readings: dict[str, dict[str, SensorValue]]
    eventTimeline: list[dict[str, Any]] | None = None
    activePatterns: list[str] | None = None
    mode: str | None = Field(None, max_length=32)
    activeScenario: str | None = Field(None, max_length=64)
    injectedSensors: list[str] | None = None
    weatherSource: str | None = Field(None, max_length=200)

    @field_validator("readings")
    @classmethod
    def _bounded_readings(cls, v):
        if len(v) > 20 or any(len(s) > 20 for s in v.values()):
            raise ValueError("too many buildings/sensors (max 20 x 20)")
        if any(len(b) > 40 or any(len(k) > 40 for k in s) for b, s in v.items()):
            raise ValueError("building/sensor ids must be <= 40 chars")
        return v

    @field_validator("eventTimeline")
    @classmethod
    def _bounded_timeline(cls, v):
        if v is None:
            return v
        out = []
        for ev in v[-50:]:
            out.append({k: (str(val)[:200] if isinstance(val, str) else val)
                        for k, val in ev.items() if k in ("type", "message", "timestamp", "tick")})
        return out

    @field_validator("activePatterns", "injectedSensors")
    @classmethod
    def _bounded_str_list(cls, v):
        return None if v is None else [str(x)[:80] for x in v[:50]]


@app.post("/api/sensors/batch")
async def ingest_sensor_batch(batch: SensorBatch):
    sid = require_station(batch.stationId)
    points = store.record_batch(sid, batch.model_dump())
    return {"status": "accepted", "stationId": sid,
            "receivedAt": int(time.time() * 1000), "historyPoints": points}


# ── Health ───────────────────────────────────────────────────

_sim_probe_lock = threading.Lock()
_sim_probe_cache = {"at": 0.0, "value": None}


def _check_db() -> dict:
    try:
        with db.connect() as conn:
            conn.execute("SELECT 1 FROM observations LIMIT 1").fetchall()
        return {"ok": True, "path": str(db.DB_PATH), "error": None}
    except Exception as exc:
        log.warning("Health: DB check failed: %s", exc)
        return {"ok": False, "path": str(db.DB_PATH), "error": str(exc)}


def _probe_simulator() -> dict:
    """GET simulator /health + /api/chronos-status (1 s timeout, cached 5 s)."""
    with _sim_probe_lock:
        if _sim_probe_cache["value"] is not None and time.monotonic() - _sim_probe_cache["at"] < 5:
            return _sim_probe_cache["value"]
    base = app_config.SIMULATOR_URL
    result = {
        "simulator": {"reachable": False, "url": base, "error": None},
        "chronos": {"available": "unknown", "modelLoaded": "unknown", "source": "simulator"},
    }
    try:
        requests.get(f"{base}/health", timeout=1).raise_for_status()
        result["simulator"]["reachable"] = True
        cs = requests.get(f"{base}/api/chronos-status", timeout=1).json()
        result["chronos"] = {"available": bool(cs.get("chronos_available")),
                             "modelLoaded": bool(cs.get("model_loaded")), "source": "simulator"}
    except Exception as exc:
        log.info("Health: simulator probe failed: %s", exc)
        result["simulator"]["error"] = str(exc)[:200]
    with _sim_probe_lock:
        _sim_probe_cache.update(at=time.monotonic(), value=result)
    return result


@app.head("/api/health", include_in_schema=False)
async def health_head():
    """Liveness probe. HEAD answers 200 with no body, so `curl -I`, load balancers and
    uptime checks work; FastAPI's @app.get does not register HEAD on its own (it would
    be a 405). The detailed report is on GET."""
    return Response(status_code=200)


@app.get("/api/health")
async def health():
    db = await asyncio.to_thread(_check_db)
    probe = await asyncio.to_thread(_probe_simulator)
    stations = {}
    for sid in STATIONS:
        snap = store.get_published(sid)
        age = store.batch_age(sid)
        stations[sid] = {
            "dataSource": snap["dataSource"] if snap else None,
            "lastBatchAgeSec": None if age is None else round(age, 1),
            "historyPoints": store.history_len(sid),
        }
    return {
        "status": "ok" if db["ok"] else "degraded",
        "version": app_config.APP_VERSION,
        "db": db,
        "simulator": probe["simulator"],
        "chronos": probe["chronos"],
        "stations": stations,
    }


@app.get("/api/ai/analysis")
def get_ai_analysis(sid: str = Depends(station_param)):
    risk = assess_blizzard_and_polar_risks(sid)
    snap = published_snapshot(sid)
    return {
        "stationId": sid,
        "overallHealth": risk["overall_health"],
        "riskScore": risk["risk_score"],
        "windChill": risk["wind_chill_c"],
        "currentWeather": risk["current_weather"],
        # Cascade alerts (shape expected by DependencyGraph.jsx) — ported from legacy ai-service
        "dependencyAlerts": snap["dependencyAlerts"],
        "telemetryHealth": snap["aiHealth"],
        "dataSource": snap["dataSource"],
        # Weather/blizzard rule hits (previously mislabelled as dependencyAlerts)
        "riskAlerts": risk["identified_risks"],
        "provenance": risk["provenance"]
    }

# NOTE: the old GET /api/predictions (value × 0.98 "predictions") was removed —
# real model outputs are served by /api/ai/anomaly, /api/ai/forecast, /api/ai/chronos.

@app.get("/api/ncpor/live")
def get_ncpor_live(sid: str = Depends(station_param)):
    weather = get_latest_weather_for_station(sid)
    return {
        "status": "success",
        "stationId": sid,
        "stationName": station_config.meta_value(sid, "fullName"),
        "weather": {
            "temperature_c": weather["temp"],
            "wind_speed_ms": weather["wind"],
            "wind_speed_kmh": round(ms_to_kmh(weather["wind"]), 1),
            "air_pressure_hpa": weather["pressure"],
            "relative_humidity_pct": weather["humidity"],
            "source": weather["source"],
            # The actual dataset of the latest DB row (was always labelled "NCPOR Live AWS")
            "dataset": weather.get("dataset"),
            "provenance": _weather_provenance(weather),
            "latitude": station_config.meta_value(sid, "latitude"),
            "longitude": station_config.meta_value(sid, "longitude")
        }
    }

@app.post("/api/ncpor/ingest")
def trigger_ncpor_ingestion(sid: str | None = Depends(optional_station_param)):
    results = {}
    if sid:
        results[sid] = ingest_live_station(sid)
    else:
        results["maitri"] = ingest_live_station("maitri")
        results["bharati"] = ingest_live_station("bharati")
    return {"status": "success", "results": results}

@app.get("/api/ncpor/observations")
def get_ncpor_observations(
    sid: str = Depends(station_param),
    parameter: str = "temperature",
    limit: int = 200
):
    df = query_observations(sid, parameter, limit=limit)
    if df.empty:
        return {"status": "empty", "records": []}
    return {
        "status": "success",
        "stationId": sid,
        "parameter": parameter,
        "count": len(df),
        "window": df.attrs.get("window"),
        "records": df.to_dict(orient="records")
    }

# ═══════════════════════════════════════════════════════════════
#  Analytics, Anomaly Detection & Forecasting
# ═══════════════════════════════════════════════════════════════

@app.get("/api/anomaly")
def get_anomaly_results(
    sid: str = Depends(station_param),
    parameter: str = "temperature",
    algorithm: str = "isf"
):
    return run_anomaly_detection(sid, parameter, algorithm)

@app.get("/api/forecast")
def get_forecast_results(
    sid: str = Depends(station_param),
    parameter: str = "temperature",
    model: str = "arima",
    horizon: int = 24
):
    return run_time_series_forecast(sid, parameter, model, horizon)

@app.get("/api/correlation")
def get_correlation_matrix(sid: str = Depends(station_param)):
    return run_correlation_matrix(sid)

@app.get("/api/risk")
def get_station_risk(sid: str = Depends(station_param)):
    return assess_blizzard_and_polar_risks(sid)

# ═══════════════════════════════════════════════════════════════
#  Digital Twin Inspector Causal Chain
# ═══════════════════════════════════════════════════════════════

@app.get("/api/twin-inspector")
def get_twin_inspector(sid: str = Depends(station_param)):
    """ONE schema (twin_inspector.build_twin_inspector) for both sources (B13).
    Simulator live → its causal chain (proxied); otherwise the backend's physics
    fallback (read-only — never calls pm.compute())."""
    snap = published_snapshot(sid)
    if snap["dataSource"] == "simulator":
        try:
            data = _sim_request("GET", "/api/twin-inspector", params={"station": sid})
            data["telemetrySource"] = "simulator"
            return data
        except HTTPException as exc:
            log.info("Twin inspector: simulator unavailable (%s); using physics fallback", exc.detail)
    fallback = store.get_fallback(sid)
    if fallback is None:
        raise HTTPException(status_code=503, detail="Telemetry not ready yet; retry shortly")
    weather = fallback["weather"]
    env_type = _weather_provenance(weather).lower()
    return build_twin_inspector(
        station_id=sid,
        mode="physics-fallback",
        tick_count=None,
        values=fallback["sensors"],
        meta=fallback["meta"],
        params=PHYSICS[sid].params,
        environment_source=f"{weather.get('source')} ({weather.get('dataset') or 'no dataset'})",
        environment_source_type=env_type,
        simulated_time=None,
        data_source={"mode": "physics-fallback", "sourceType": env_type,
                     "label": "Backend physics fallback driven by the latest DB weather row",
                     "weatherDataset": weather.get("dataset")},
        telemetry_source="physics-fallback",
    )

# ═══════════════════════════════════════════════════════════════
#  What-If Scenario Simulation Engine
# ═══════════════════════════════════════════════════════════════

WHATIF_SCENARIOS = ("extreme_cold", "blizzard", "gen_failure", "battery_failure", "fuel_leak",
                    "comms_outage", "resupply_delay")


class WhatIfRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stationId: StationIdStr
    scenarioId: Literal[WHATIF_SCENARIOS]
    intensity: float = Field(1.0, ge=0.5, le=2.0, allow_inf_nan=False)   # multiplier

@app.post("/api/simulation/whatif")
def run_what_if_simulation(req: WhatIfRequest):
    station_id = require_station(req.stationId)
    base = published_snapshot(station_id)   # read-only baseline (no physics advance)
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

        impacts.append(f"Outside temperature drops to {sim_weather['env_temp']:.1f}°C "
                       f"({temp_drop:.1f}°C below current NCPOR observation).")
        impacts.append(f"Heating circuit load increases by +{power_spike:.1f} kW "
                       f"(+{power_spike/max(1, gen['gen_power'])*100:.0f}% total demand).")
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

        impacts.append(f"Sustained wind accelerates to {sim_weather['env_wind']:.0f} km/h "
                       f"({kmh_to_ms(sim_weather['env_wind']):.1f} m/s gale force).")
        impacts.append("Building aerodynamic buffeting doubles thermal convection loss across unshielded facades.")
        impacts.append("Satellite dish azimuth drives automatically locked in stow position to prevent gimbal shear.")
        impacts.append("Life-line secured transit corridors mandated between living module and generator block.")

        affected_subsystems = ["Communications Tower", "Outdoor Structural Safety", "HVAC Air Intakes", "Helipad"]
        risk_score = min(98, int(72 + 16 * req.intensity))
        risk_level = "critical"
        action = ("Enforce Station Condition Red lockdown, stow steerable antenna dishes, and switch primary "
                  "communications to Iridium SBD backup.")

    elif req.scenarioId == "gen_failure":
        sim_gen["gen_power"] = 0.0
        sim_gen["gen_rpm"] = 0.0
        sim_gen["gen_fuel_rate"] = 0.0
        sim_gen["gen_temp"] = 32.0

        impacts.append("Primary Volvo Penta Diesel Genset #1 tripped offline (0 kW output, 0 RPM).")
        impacts.append("Automatic Static Transfer Switch (STS) transferred critical bus to 120 kWh Station Battery "
                        "Bank.")
        impacts.append("Battery autonomy calculated at 3.8 hours under essential load profile (18 kW).")
        impacts.append("HVAC circulation pumps running on emergency inverter sub-panel.")

        affected_subsystems = ["Electrical Power Grid", "Heating Distribution", "Scientific Labs", "Life Support"]
        risk_score = 95
        risk_level = "critical"
        action = ("Execute immediate non-essential load shedding (isolate scientific instruments, garage heaters) and "
                  "dispatch auto-start sequence for Genset #2.")

    elif req.scenarioId == "battery_failure":
        sim_gen["gen_power"] = gen["gen_power"] * 1.15
        sim_gen["gen_fuel_rate"] = gen["gen_fuel_rate"] * 1.18

        impacts.append("Station Battery Bank (UPS) disconnected following internal cell thermal runaway fault.")
        impacts.append("Grid peak-shaving lost; primary generator operating without electrical buffer against "
                        "inductive transient spikes.")
        impacts.append("Emergency transition time in the event of generator trip reduced from 4 hours to 0 seconds.")

        affected_subsystems = ["UPS Power Buffer", "DC Distribution Bus", "Instrumentation Protection"]
        risk_score = 82
        risk_level = "critical"
        action = ("Synchronize auxiliary Genset #2 in hot standby mode to eliminate single-point-of-failure risk on the"
                  " primary grid.")

    elif req.scenarioId == "fuel_leak":
        extra_burn = 16.0 * req.intensity
        sim_gen["gen_fuel_rate"] += extra_burn

        impacts.append(f"Abnormal fuel flow detected in feeder header (+{extra_burn:.1f} L/hr unmetered loss).")
        impacts.append("Estimated fuel supply longevity reduced from 180 days to 58 days if unaddressed.")
        impacts.append("Combustible vapor sensors in fuel trench reporting elevated hydrocarbon ppm.")

        affected_subsystems = ["Fuel Storage Manifold", "Generator Supply Line", "Environmental Containment"]
        risk_score = min(92, int(70 + 15 * req.intensity))
        risk_level = "critical"
        action = ("Actuate solenoid isolation valve SV-04 to isolate Main Fuel Line Trench and switch generator feed to"
                  " Day Tank #2.")

    elif req.scenarioId == "comms_outage":
        sim_comms["comms_signal"] = -120.0
        sim_comms["comms_bandwidth"] = 0.0
        sim_comms["comms_uptime"] = 0.0

        impacts.append("Primary Geostationary VSAT uplink lost (Geomagnetic solar storm / RF transponder loss).")
        impacts.append("Mission Control high-bandwidth telemetry stream disconnected; station operating in autonomous "
                        "edge mode.")
        impacts.append("Autonomous PLC edge controllers executing fail-safe thermal and power governing routines "
                        "locally.")

        affected_subsystems = ["Satellite Comms", "Remote Telemetry Uplink", "Science Data Relay"]
        risk_score = 70
        risk_level = "warning"
        action = ("Engage Iridium Short Burst Data (SBD) emergency low-bandwidth transceiver and verify local "
                  "autonomous edge controllers.")

    elif req.scenarioId == "resupply_delay":
        days_delay = int(60 * req.intensity)
        impacts.append(f"MV Vasiliy Golovnin expedition arrival delayed by {days_delay} days "
                       f"due to dense fast-ice pack in Prydz Bay.")
        impacts.append("Station wintering reserve margin compressed from 240 days to nominal winter length.")
        impacts.append("Mandatory conservation protocol: thermal setpoint reduced by -1.5°C to save ~14% monthly "
                        "diesel consumption.")

        affected_subsystems = ["Fuel Autonomy", "Food Rations", "Spare Parts Reserve"]
        risk_score = 65
        risk_level = "warning"
        action = ("Enact Level-2 Fuel & Rations Conservation: lower indoor corridor temperature to 19°C and optimize "
                  "generator load scheduling.")

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
        "dataSource": base["dataSource"],
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
        "provenance": ("Calculated by Antarctic Digital Twin Causal Simulation Engine on "
                       f"{station_id.upper()} NCPOR AWS baseline")
    }

# ═══════════════════════════════════════════════════════════════
#  Satellite Link & Connection Management APIs
# ═══════════════════════════════════════════════════════════════

@app.post("/api/connection/toggle")
def toggle_station_connection(sid: str = Depends(station_param)):
    curr = store.toggle_connected(sid)
    return {"status": "success", "stationId": sid, "connected": curr}

@app.get("/api/connection/status")
def get_station_connection_status(sid: str = Depends(station_param)):
    return {"status": "success", "stationId": sid, "connected": store.is_connected(sid)}

class AcknowledgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    acknowledgedBy: OperatorName


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str, req: AcknowledgeRequest):
    if len(alert_id) > 120:
        raise HTTPException(status_code=422, detail=["alert id too long"])
    try:
        row = ALERTS.acknowledge(alert_id, req.acknowledgedBy)
    except AlertNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Unknown alert '{alert_id}'") from exc
    return {"status": "success", "alertId": alert_id, "acknowledged": True,
            "acknowledgedBy": row["acknowledged_by"], "acknowledgedAt": row["acknowledged_at"],
            "alertStatus": row["status"], "alreadyAcknowledged": row["alreadyAcknowledged"]}


@app.get("/api/alerts/history")
def get_alert_history(sid: str = Depends(station_param), limit: int = Query(100, ge=1, le=500)):
    rows = ALERTS.history(sid, limit)
    names = station_config.building_names(sid)
    return {"stationId": sid, "alerts": [{
        "id": r["id"], "sensor": r["parameter"], "buildingId": r["subsystem"],
        "buildingName": names.get(r["subsystem"], r["subsystem"]), "level": r["severity"],
        "peakLevel": r["peak_severity"] or r["severity"], "direction": r["direction"],
        "threshold": r["threshold_value"], "unit": r["unit"], "value": r["observed_value"],
        "message": r["reason"], "status": r["status"], "raisedAt": r["timestamp"],
        "resolvedAt": r["resolved_at"], "acknowledgedBy": r["acknowledged_by"],
        "acknowledgedAt": r["acknowledged_at"]} for r in rows]}

# ═══════════════════════════════════════════════════════════════
#  Logistics & Operational Inventory APIs
# ═══════════════════════════════════════════════════════════════

def _inventory_item(r) -> dict:
    current = r["current"]
    daily = r["daily_consumption"]
    return {
        "id": r["id"],
        "name": r["name"],
        "category": r["category"],
        "current": current,
        "max": r["max_capacity"],
        "unit": r["unit"],
        "dailyUse": daily,
        "reorderAt": r["reorder_threshold"],
        "daysRemaining": round(current / daily, 1) if daily > 0 else None,
        "isLow": current <= r["reorder_threshold"],
        "lastUpdated": r["last_updated"],
        "updatedBy": r["updated_by"],
        "provenance": r["provenance"],
    }


@app.get("/api/logistics")
def get_logistics(sid: str = Depends(station_param)):
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM logistics_inventory WHERE station_id = ? ORDER BY id", (sid,)).fetchall()
    return {"stationId": sid, "items": [_inventory_item(r) for r in rows]}


class InventoryUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stationId: StationIdStr
    itemId: Identifier
    current: float = Field(ge=0, le=1e9, allow_inf_nan=False)
    dailyConsumption: float | None = Field(None, ge=0, le=1e7, allow_inf_nan=False)
    updatedBy: OperatorName


@app.post("/api/logistics/update")
def update_inventory_item(req: InventoryUpdateRequest):
    sid = require_station(req.stationId)
    now_ts = int(time.time() * 1000)
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM logistics_inventory WHERE id = ? AND station_id = ?",
                           (req.itemId, sid)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Unknown inventory item '{req.itemId}' for station '{sid}'")
        if req.current > row["max_capacity"]:
            raise HTTPException(status_code=422, detail=[
                f"current ({req.current}) exceeds max capacity ({row['max_capacity']} {row['unit']}) of {req.itemId}"])
        changes = [("current", row["current"], req.current)]
        if req.dailyConsumption is not None:
            changes.append(("daily_consumption", row["daily_consumption"], req.dailyConsumption))
        changes = [(f, old, new) for f, old, new in changes if float(old) != float(new)]
        conn.execute(
            "UPDATE logistics_inventory SET current = ?, daily_consumption = ?, last_updated = ?, updated_by = ? "
            "WHERE id = ? AND station_id = ?",
            (req.current, req.dailyConsumption if req.dailyConsumption is not None else row["daily_consumption"],
             now_ts, req.updatedBy, req.itemId, sid))
        conn.executemany(
            "INSERT INTO logistics_audit (station_id, item_id, field, old_value, new_value, updated_by, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(sid, req.itemId, f, str(old), str(new), req.updatedBy, now_ts) for f, old, new in changes])
        updated = conn.execute("SELECT * FROM logistics_inventory WHERE id = ?", (req.itemId,)).fetchone()
    log.info("Inventory %s/%s updated by %s: %s", sid, req.itemId, req.updatedBy,
             ", ".join(f"{f} {old}→{new}" for f, old, new in changes) or "no change")
    return {"status": "success", "item": _inventory_item(updated), "changes": len(changes)}


@app.get("/api/logistics/history")
def get_logistics_history(sid: str = Depends(station_param),
                          itemId: str | None = Query(None, max_length=64),
                          limit: int = Query(100, ge=1, le=500)):
    with db.connect() as conn:
        if itemId:
            rows = conn.execute(
                "SELECT * FROM logistics_audit WHERE station_id = ? AND item_id = ? "
                "ORDER BY updated_at DESC, id DESC LIMIT ?",
                (sid, itemId, limit)).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM logistics_audit WHERE station_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?",
                (sid, limit)).fetchall()
    return {"stationId": sid, "history": [
        {"id": r["id"], "itemId": r["item_id"], "field": r["field"], "oldValue": r["old_value"],
         "newValue": r["new_value"], "updatedBy": r["updated_by"], "updatedAt": r["updated_at"]} for r in rows]}

# ═══════════════════════════════════════════════════════════════
#  Remote Command & Control APIs (SIMULATED dispatch — no station link)
# ═══════════════════════════════════════════════════════════════

CMD_QUEUED = "queued (simulated)"
CMD_ACKNOWLEDGED = "acknowledged (simulated)"


class DispatchCommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stationId: StationIdStr
    subsystem: str = Field(min_length=1, max_length=40)
    command: Identifier
    parameters: dict[str, str | float | int | bool] | None = Field(None, max_length=10)
    issuedBy: OperatorName


@app.post("/api/remote/dispatch")
def dispatch_remote_command(req: DispatchCommandRequest):
    sid = require_station(req.stationId)
    catalog = station_config.remote_command_catalog()
    if req.subsystem not in catalog:
        raise HTTPException(status_code=422, detail=[
            f"unknown subsystem '{req.subsystem}'. Known: {', '.join(catalog)}"])
    if req.command not in catalog[req.subsystem]:
        raise HTTPException(status_code=422, detail=[
            f"unknown command '{req.command}' for {req.subsystem}. Known: {', '.join(catalog[req.subsystem])}"])
    now_ts = int(time.time() * 1000)
    cmd_id = f"CMD-{now_ts}-{sid[:3].upper()}-{uuid.uuid4().hex[:6]}"
    with db.connect() as conn:
        conn.execute("""
            INSERT INTO remote_commands
            (id, station_id, subsystem, command, parameters, status, created_at, dispatched_at, issued_by, response_log)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (cmd_id, sid, req.subsystem, req.command, json.dumps(req.parameters or {}), CMD_QUEUED, now_ts,
              None, req.issuedBy,
              "SIMULATED dispatch: recorded only. No station actuation link exists; nothing will be executed."))
    return {
        "status": CMD_QUEUED,
        "simulated": True,
        "commandId": cmd_id,
        "message": (f"Simulated dispatch: '{req.command}' for {sid} {req.subsystem} was recorded. "
                    "No real actuation link exists."),
    }


def promote_remote_commands(now_ms: int | None = None) -> int:
    """Lifecycle step run by the tick: queued (simulated) → acknowledged (simulated)
    after REMOTE_ACK_DELAY_S. Never 'executed' — there is no station link."""
    now_ms = now_ms or int(time.time() * 1000)
    cutoff = now_ms - int(app_config.REMOTE_ACK_DELAY_S * 1000)
    with db.connect() as conn:
        cur = conn.execute(
            "UPDATE remote_commands SET status = ?, acknowledged_at = ?, "
            "response_log = response_log || ' | Simulated acknowledgement (no station link; not executed).' "
            "WHERE status = ? AND created_at <= ?",
            (CMD_ACKNOWLEDGED, now_ms, CMD_QUEUED, cutoff))
    return cur.rowcount


def _command_out(r) -> dict:
    d = dict(r)
    lifecycle = [{"state": CMD_QUEUED, "at": r["created_at"]}]
    if r["acknowledged_at"]:
        lifecycle.append({"state": CMD_ACKNOWLEDGED, "at": r["acknowledged_at"]})
    d["lifecycle"] = lifecycle
    d["simulated"] = True
    return d


@app.get("/api/remote/commands")
def get_remote_commands(sid: str = Depends(station_param), limit: int = Query(50, ge=1, le=200)):
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM remote_commands WHERE station_id = ? ORDER BY created_at DESC LIMIT ?",
                            (sid, limit)).fetchall()
    return {"stationId": sid, "commands": [_command_out(r) for r in rows],
            "catalog": station_config.remote_command_catalog()}

# ═══════════════════════════════════════════════════════════════
#  Alert Management APIs
# ═══════════════════════════════════════════════════════════════

@app.get("/api/alerts")
def get_alerts(sid: str = Depends(station_param)):
    snap = published_snapshot(sid)   # read-only
    return {
        "stationId": sid,
        "activeAlerts": snap["activeAlerts"],
        "alerts": snap["alerts"],
        "dependencyAlerts": snap["dependencyAlerts"],
        "dataSource": snap["dataSource"],
    }

# ═══════════════════════════════════════════════════════════════
#  Admin & Configuration APIs
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/config")
def get_admin_config(sid: str = Depends(station_param)):
    sensors = station_config.sensors(sid)
    overrides = alert_engine.load_overrides(sid)
    return {
        "system": {
            "name": "AURORA Antarctic Digital Twin Platform",
            "version": app_config.APP_VERSION,
            "activeStations": [station_config.meta_value(s_id, "name") for s_id in STATIONS],
            "ingestionSource": "Open-Meteo ERA5 reanalysis cache + NCPOR AWS live page scrape (manual ingest)",
        },
        # HARDCODED-DEMO: example roles only — there is no authentication or RBAC yet (P1-8).
        "usersProvenance": "HARDCODED-DEMO (no authentication / RBAC implemented)",
        "users": [
            {"id": "usr-01", "name": "Station Commander", "role": "Commander",
             "station": "All", "access": "Full Control"},
            {"id": "usr-02", "name": "Chief Electrical Engineer", "role": "Engineer",
             "station": "Maitri", "access": "C&C Dispatch"},
            {"id": "usr-03", "name": "Scientific Observer", "role": "Observer",
             "station": "Bharati", "access": "Read-Only Analytics"},
            {"id": "usr-04", "name": "Logistics Officer", "role": "Logistics",
             "station": "All", "access": "Inventory Management"}
        ],
        "stationId": sid,
        # Effective thresholds used by the alert engine for this station.
        "thresholds": alert_engine.effective_thresholds(sid, overrides),
        "thresholdDefaults": station_config.default_thresholds(sid),
        "thresholdOverrides": overrides,
        "thresholdRules": {k: {"name": v["name"], "building": v["building"], "unit": v["unit"],
                               "min": v["thresholdRange"][0], "max": v["thresholdRange"][1], "basis": v["basis"]}
                           for k, v in sensors.items()},
        "alertResolveTicks": ALERTS.resolve_ticks,
        "thresholdsUsedByAlerts": True,
    }


class ThresholdLevels(BaseModel):
    model_config = ConfigDict(extra="forbid")
    warning: float | None = Field(None, allow_inf_nan=False)
    critical: float | None = Field(None, allow_inf_nan=False)


class SensorThresholdUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    low: ThresholdLevels | None = None
    high: ThresholdLevels | None = None


class ConfigUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stationId: StationIdStr                      # a station id, or "*" for every station
    thresholds: dict[str, SensorThresholdUpdate] = Field(min_length=1, max_length=40)
    updatedBy: OperatorName


def _scope(raw: str) -> str:
    return "*" if raw.strip() == "*" else require_station(raw)


@app.post("/api/admin/config")
def update_admin_config(req: ConfigUpdateRequest):
    scope = _scope(req.stationId)
    updates = {
        sensor: {d: {lvl: v for lvl, v in levels.model_dump().items() if v is not None}
                 for d, levels in (("low", u.low), ("high", u.high)) if levels is not None}
        for sensor, u in req.thresholds.items()
    }
    updates = {k: {d: lv for d, lv in v.items() if lv} for k, v in updates.items()}
    updates = {k: v for k, v in updates.items() if v}
    if not updates:
        raise HTTPException(status_code=422, detail=["no threshold values given"])
    errors = alert_engine.validate_threshold_update(scope, updates)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    n = alert_engine.save_overrides(scope, updates, req.updatedBy)
    log.info("Alert thresholds updated by %s for %s: %s", req.updatedBy, scope, updates)
    shown = STATIONS[0] if scope == "*" else scope
    return {"status": "saved", "stationId": scope, "valuesSaved": n, "updatedAt": int(time.time() * 1000),
            "thresholds": alert_engine.effective_thresholds(shown), "thresholdsUsedByAlerts": True}


class ThresholdResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stationId: StationIdStr
    sensor: Identifier | None = None
    updatedBy: OperatorName


@app.post("/api/admin/config/reset")
def reset_admin_thresholds(req: ThresholdResetRequest):
    scope = _scope(req.stationId)
    if req.sensor is not None and req.sensor not in station_config.sensors(STATIONS[0] if scope == "*" else scope):
        raise HTTPException(status_code=404, detail=f"Unknown sensor '{req.sensor}'")
    removed = alert_engine.reset_overrides(scope, req.sensor)
    log.info("Alert threshold overrides reset by %s for %s/%s: %d removed", req.updatedBy, scope, req.sensor, removed)
    return {"status": "reset", "stationId": scope, "sensor": req.sensor, "removed": removed}

# ═══════════════════════════════════════════════════════════════
#  Real AI pipeline (proxied from the internal simulator, :SIM_PORT)
# ═══════════════════════════════════════════════════════════════

SIM_TIMEOUT_S = 3.0
EXPLAIN_TIMEOUT_S = 20.0
MODE_TIMEOUT_S = 30.0   # /mode rebuilds simulators (may load weather caches)


def _sim_request(method: str, path: str, *, params=None, json_body=None, timeout=SIM_TIMEOUT_S):
    """Call the internal simulator. Down/timeout/5xx → HTTP 503 with a clear reason."""
    url = f"{app_config.SIMULATOR_URL}{path}"
    try:
        r = requests.request(method, url, params=params, json=json_body, timeout=timeout)
    except requests.Timeout as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Simulator offline: no response from {app_config.SIMULATOR_URL} within {timeout:g} s",
        ) from exc
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Simulator offline: cannot reach {app_config.SIMULATOR_URL} ({type(exc).__name__})",
        ) from exc
    if r.status_code >= 500:
        raise HTTPException(status_code=503, detail=f"Simulator error: HTTP {r.status_code} from {path}")
    try:
        data = r.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Simulator returned invalid JSON from {path}") from exc
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=data)
    return data


@app.get("/api/ai/anomaly")
def ai_anomaly(sid: str = Depends(station_param)):
    return {**_sim_request("GET", "/api/anomaly", params={"station": sid}), "source": "simulator"}


@app.get("/api/ai/decision")
def ai_decision(sid: str = Depends(station_param)):
    return {**_sim_request("GET", "/api/decision", params={"station": sid}), "source": "simulator"}


@app.get("/api/ai/forecast")
def ai_forecast(sid: str = Depends(station_param)):
    return {**_sim_request("GET", "/api/forecast", params={"station": sid}), "source": "simulator"}


@app.get("/api/ai/chronos")
def ai_chronos(sid: str = Depends(station_param)):
    return {**_sim_request("GET", "/api/chronos-forecast", params={"station": sid}), "source": "simulator"}


# ── Demo Control / replay controls (so the browser never calls :SIM_PORT) ──

@app.get("/api/sim/scenarios")
def sim_scenarios(sid: str = Depends(station_param)):
    return _sim_request("GET", "/scenarios", params={"station": sid})


@app.post("/api/sim/inject/{scenario_id}")
def sim_inject(scenario_id: str, sid: str = Depends(station_param)):
    if not re.fullmatch(r"[a-z0-9_]{1,40}", scenario_id):
        raise HTTPException(status_code=422, detail=["invalid scenario id"])
    return _sim_request("POST", f"/inject/{scenario_id}", params={"station": sid})


@app.post("/api/sim/reset")
def sim_reset(sid: str = Depends(station_param)):
    return _sim_request("POST", "/reset", params={"station": sid})


class ModeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["reanalysis", "simulation"] = "reanalysis"
    date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    speed: float = Field(120.0, ge=1.0, le=3600.0, allow_inf_nan=False)

    @field_validator("date")
    @classmethod
    def _real_date(cls, v):
        if v is not None:
            datetime.strptime(v, "%Y-%m-%d")      # ValueError → 422 (e.g. 2024-02-31)
        return v


@app.post("/api/sim/mode")
def sim_mode(req: ModeRequest):
    return _sim_request("POST", "/mode", json_body=req.model_dump(), timeout=MODE_TIMEOUT_S)


# ═══════════════════════════════════════════════════════════════
#  Explanation: LLM via simulator (Groq) or honest offline summary
# ═══════════════════════════════════════════════════════════════

class ExplainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    station: StationIdStr | None = None
    stationId: StationIdStr | None = None
    question: str = Field("status", min_length=1, max_length=32, pattern=r"^[A-Za-z_]+$")
    freeText: str = Field("", max_length=2000)


_LLM_FAILURE_PREFIXES = ("LLM explanation", "Decision engine has not")


@app.post("/api/aurora-explain")
@app.post("/api/explain")
@app.post("/api/ai/explain")
def get_ai_explanation(req: ExplainRequest):
    """Forward question + freeText to the simulator's Groq layer. With no key,
    Groq/simulator unreachable or an upstream error, return a deterministic
    summary of the current decision JSON labelled 'offline summary'."""
    sid = require_station(req.stationId or req.station or "maitri")
    reason = None
    try:
        res = _sim_request("POST", "/api/aurora-explain", timeout=EXPLAIN_TIMEOUT_S,
                           json_body={"station": sid, "question": req.question, "freeText": req.freeText})
        text = str(res.get("explanation", ""))
        if res.get("llmAvailable") and not text.startswith(_LLM_FAILURE_PREFIXES):
            return {**res, "station": sid, "mode": "llm", "llmAvailable": True}
        reason = text or "LLM unavailable"
    except HTTPException as exc:
        reason = str(exc.detail)
        log.info("Explain: LLM path unavailable (%s); using offline summary", reason)

    try:
        decision = _sim_request("GET", "/api/decision", params={"station": sid})
        if (decision.get("risk") or {}).get("level") == "unknown":
            decision = None     # simulator up but no decision computed yet
    except HTTPException as exc:
        log.info("Explain: decision unavailable (%s)", exc.detail)
        decision = None
    out = offline_explanation(decision, req.question, req.freeText, sid, store.get_published(sid))
    out.update({"station": sid, "reason": reason,
                "sources": ["decision_engine"] if decision else ["telemetry_snapshot"]})
    return out

if __name__ == "__main__":
    import uvicorn
    # log_config=None: uvicorn's loggers propagate to the root handler configured in config.py,
    # so every service line has the same format and honours LOG_LEVEL.
    uvicorn.run(app, host=app_config.HOST, port=app_config.API_PORT, log_config=None,
                log_level=app_config.LOG_LEVEL.lower())
