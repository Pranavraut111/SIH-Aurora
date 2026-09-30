"""
Aurora — AI Anomaly Detection Service (FastAPI)
Lightweight anomaly detection using:
  1. Exponential smoothing forecaster (Chronos-lite)
  2. Z-score anomaly scoring
  3. Dependency graph cascade analysis

Runs on port 8000. Called by Spring Boot backend every tick.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import math
import os
import time
from collections import defaultdict, deque

app = FastAPI(title="Aurora AI Service", version="0.1.0")

# LEGACY service (see CLAUDE.md). Network settings come from env vars:
#   ALLOWED_ORIGINS  comma-separated CORS origins (default http://localhost:5173; "*" ignored)
#   HOST             bind address (default 127.0.0.1)
ALLOWED_ORIGINS = [
    o.strip().rstrip("/")
    for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip() and o.strip() != "*"
] or ["http://localhost:5173"]
HOST = os.environ.get("HOST", "127.0.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# ═══════════════════════════════════════════════════════════════
#  Data Models
# ═══════════════════════════════════════════════════════════════

class SensorReading(BaseModel):
    sensorId: str
    value: float
    unit: str

class BuildingSensors(BaseModel):
    buildingId: str
    sensors: list[SensorReading]

class AnalyzeRequest(BaseModel):
    stationId: str
    buildings: list[BuildingSensors]

class AnomalyVerdict(BaseModel):
    buildingId: str
    sensorId: str
    chronosAnomaly: bool
    dependencyRisk: bool
    verdict: str          # "normal", "warning", "critical"
    explanation: str
    predictedValue: float
    actualValue: float
    anomalyScore: float

class AnalyzeResponse(BaseModel):
    stationId: str
    timestamp: int
    verdicts: list[AnomalyVerdict]
    dependencyAlerts: list[dict]
    overallHealth: str    # "healthy", "degraded", "critical"

# ═══════════════════════════════════════════════════════════════
#  Dependency Graph — hard-coded station topology
# ═══════════════════════════════════════════════════════════════

DEPENDENCY_GRAPH = {
    "generator": {
        "dependents": ["heating", "heatingB", "waterTank", "commsMast", "livingQuarters"],
        "critical_sensors": ["gen_power", "gen_rpm"],
        "description": "Primary power source for all station systems",
    },
    "heating": {
        "depends_on": ["generator"],
        "dependents": ["livingQuarters"],
        "critical_sensors": ["heat_a_temp", "heat_a_flow"],
        "description": "Heating Zone A — feeds living quarters",
    },
    "heatingB": {
        "depends_on": ["generator"],
        "dependents": ["livingQuarters"],
        "critical_sensors": ["heat_b_temp"],
        "description": "Heating Zone B — backup heating circuit",
    },
    "waterTank": {
        "depends_on": ["generator"],
        "dependents": ["livingQuarters", "lab"],
        "critical_sensors": ["water_level"],
        "description": "Water treatment and storage",
    },
    "commsMast": {
        "depends_on": ["generator"],
        "dependents": [],
        "critical_sensors": ["comms_signal", "comms_uptime"],
        "description": "Satellite communications tower",
    },
    "livingQuarters": {
        "depends_on": ["heating", "heatingB", "waterTank", "generator"],
        "dependents": [],
        "critical_sensors": ["lq_temp", "lq_co2"],
        "description": "Crew living quarters — most occupied building",
    },
    "storage": {
        "depends_on": [],
        "dependents": [],
        "critical_sensors": ["store_fuel", "store_food"],
        "description": "Logistics and supply storage",
    },
    "lab": {
        "depends_on": ["waterTank", "generator"],
        "dependents": [],
        "critical_sensors": ["env_temp"],
        "description": "Research laboratory and weather station",
    },
}

BUILDING_NAMES = {
    "generator": "Generator Shed",
    "heating": "Heating Zone A",
    "heatingB": "Heating Zone B",
    "waterTank": "Water Treatment",
    "commsMast": "Comms Tower",
    "livingQuarters": "Living Quarters",
    "storage": "Logistics Store",
    "lab": "Research Lab",
}

# ═══════════════════════════════════════════════════════════════
#  Sensor Profiles — defines normal ranges and anomaly behavior
# ═══════════════════════════════════════════════════════════════

SENSOR_PROFILES = {
    "gen_power":     {"nominal": 160, "std": 8,   "warning": 2.0, "critical": 3.0},
    "gen_fuel_rate": {"nominal": 28,  "std": 2,   "warning": 2.0, "critical": 3.0},
    "gen_rpm":       {"nominal": 1500,"std": 30,  "warning": 2.0, "critical": 3.0},
    "gen_temp":      {"nominal": 82,  "std": 4,   "warning": 2.0, "critical": 2.5},
    "heat_a_flow":   {"nominal": 35,  "std": 2,   "warning": 2.0, "critical": 3.0},
    "heat_a_temp":   {"nominal": 72,  "std": 3,   "warning": 2.0, "critical": 3.0},
    "heat_a_pressure":{"nominal": 3.2,"std": 0.2, "warning": 2.0, "critical": 3.0},
    "heat_b_flow":   {"nominal": 28,  "std": 2,   "warning": 2.0, "critical": 3.0},
    "heat_b_temp":   {"nominal": 68,  "std": 3,   "warning": 2.0, "critical": 3.0},
    "water_level":   {"nominal": 78,  "std": 5,   "warning": 2.0, "critical": 3.0},
    "water_temp":    {"nominal": 12,  "std": 1.5, "warning": 2.0, "critical": 3.0},
    "water_ph":      {"nominal": 7.1, "std": 0.1, "warning": 2.0, "critical": 3.0},
    "comms_signal":  {"nominal": -42, "std": 5,   "warning": 2.0, "critical": 3.0},
    "comms_bandwidth":{"nominal": 2.4,"std": 0.5, "warning": 2.0, "critical": 3.0},
    "comms_uptime":  {"nominal": 99.2,"std": 0.3, "warning": 2.0, "critical": 3.0},
    "lq_temp":       {"nominal": 21,  "std": 1,   "warning": 2.0, "critical": 3.0},
    "lq_humidity":   {"nominal": 42,  "std": 3,   "warning": 2.0, "critical": 3.0},
    "lq_co2":        {"nominal": 620, "std": 40,  "warning": 2.0, "critical": 2.5},
    "store_fuel":    {"nominal": 142, "std": 10,  "warning": 2.0, "critical": 3.0},
    "store_food":    {"nominal": 186, "std": 10,  "warning": 2.0, "critical": 3.0},
    "store_spares":  {"nominal": 312, "std": 20,  "warning": 2.0, "critical": 3.0},
    "env_temp":      {"nominal": -22, "std": 4,   "warning": 2.0, "critical": 3.0},
    "env_wind":      {"nominal": 35,  "std": 10,  "warning": 2.0, "critical": 2.5},
    "env_pressure":  {"nominal": 986, "std": 3,   "warning": 2.0, "critical": 3.0},
    "env_humidity":  {"nominal": 55,  "std": 5,   "warning": 2.0, "critical": 3.0},
}


# ═══════════════════════════════════════════════════════════════
#  Time-Series Forecasting Engine (Double Exponential Smoothing)
# ═══════════════════════════════════════════════════════════════

class ChronosForecaster:
    """
    Lightweight forecaster using double exponential smoothing.
    Maintains a running prediction for each sensor. The 'anomaly'
    is measured as the deviation between predicted and actual value,
    normalized by the sensor's historical standard deviation.
    """

    def __init__(self, alpha=0.3, beta=0.1):
        self.alpha = alpha  # Level smoothing
        self.beta = beta    # Trend smoothing
        self.states = {}    # sensor_key -> (level, trend)
        self.history = defaultdict(lambda: deque(maxlen=120))

    def update_and_predict(self, key: str, actual: float) -> tuple[float, float]:
        """
        Update the model with a new observation and return (predicted, anomaly_score).
        anomaly_score is the absolute z-score of the prediction error.
        """
        self.history[key].append(actual)

        if key not in self.states:
            self.states[key] = (actual, 0.0)
            return actual, 0.0

        level, trend = self.states[key]
        predicted = level + trend

        # Update level and trend
        new_level = self.alpha * actual + (1 - self.alpha) * (level + trend)
        new_trend = self.beta * (new_level - level) + (1 - self.beta) * trend
        self.states[key] = (new_level, new_trend)

        # Compute anomaly score
        error = abs(actual - predicted)
        profile = SENSOR_PROFILES.get(key.split(".")[-1])
        if profile:
            score = error / max(profile["std"], 0.01)
        else:
            # Fallback: use running std
            hist = list(self.history[key])
            if len(hist) > 5:
                mean = sum(hist) / len(hist)
                std = max(math.sqrt(sum((x - mean) ** 2 for x in hist) / len(hist)), 0.01)
                score = error / std
            else:
                score = 0.0

        return predicted, round(score, 3)


# Global forecaster instance
chronos = ChronosForecaster()


# ═══════════════════════════════════════════════════════════════
#  Dependency Cascade Analyzer
# ═══════════════════════════════════════════════════════════════

def analyze_dependency_cascade(building_alerts: dict[str, str]) -> list[dict]:
    """
    Given current building alert states, identify cascade risks.
    If an upstream system is degraded, warn about downstream impact.
    """
    cascades = []

    for building_id, alert_level in building_alerts.items():
        if alert_level in ("warning", "critical"):
            node = DEPENDENCY_GRAPH.get(building_id, {})
            dependents = node.get("dependents", [])

            for dep_id in dependents:
                dep_name = BUILDING_NAMES.get(dep_id, dep_id)
                source_name = BUILDING_NAMES.get(building_id, building_id)

                severity = "critical" if alert_level == "critical" else "warning"
                cascades.append({
                    "sourceBuilding": building_id,
                    "sourceName": source_name,
                    "affectedBuilding": dep_id,
                    "affectedName": dep_name,
                    "severity": severity,
                    "message": (
                        f"⚠️ {dep_name} at risk: depends on {source_name} "
                        f"which is in {alert_level.upper()} state"
                    ),
                    "chain": [building_id, dep_id],
                })

                # Second-order cascades (e.g., generator → heating → living quarters)
                dep_node = DEPENDENCY_GRAPH.get(dep_id, {})
                for second_dep_id in dep_node.get("dependents", []):
                    if second_dep_id != building_id:
                        second_name = BUILDING_NAMES.get(second_dep_id, second_dep_id)
                        cascades.append({
                            "sourceBuilding": building_id,
                            "sourceName": source_name,
                            "affectedBuilding": second_dep_id,
                            "affectedName": second_name,
                            "severity": "warning",
                            "message": (
                                f"⚡ Cascade risk: {source_name} → {dep_name} → {second_name}"
                            ),
                            "chain": [building_id, dep_id, second_dep_id],
                        })

    # Deduplicate by affected building
    seen = set()
    unique_cascades = []
    for c in cascades:
        key = (c["sourceBuilding"], c["affectedBuilding"])
        if key not in seen:
            seen.add(key)
            unique_cascades.append(c)

    return unique_cascades


# ═══════════════════════════════════════════════════════════════
#  API Endpoints
# ═══════════════════════════════════════════════════════════════

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    """
    Analyze sensor readings for anomalies and dependency cascades.
    Called by the Spring Boot backend every tick.
    """
    verdicts = []
    building_alerts = {}  # For dependency analysis

    for building in request.buildings:
        building_worst = "normal"

        for sensor in building.sensors:
            # Include stationId in key so each station has independent forecast state
            key = f"{request.stationId}.{building.buildingId}.{sensor.sensorId}"
            predicted, anomaly_score = chronos.update_and_predict(key, sensor.value)

            profile = SENSOR_PROFILES.get(sensor.sensorId)
            if not profile:
                continue

            # Determine verdict based on anomaly score
            is_anomaly = False
            verdict = "normal"
            explanation = "Within expected range"

            if anomaly_score >= profile["critical"]:
                verdict = "critical"
                is_anomaly = True
                explanation = (
                    f"Chronos detected critical anomaly: "
                    f"predicted {predicted:.1f}{sensor.unit}, "
                    f"got {sensor.value:.1f}{sensor.unit} "
                    f"(score: {anomaly_score:.2f}σ)"
                )
            elif anomaly_score >= profile["warning"]:
                verdict = "warning"
                is_anomaly = True
                explanation = (
                    f"Deviation from forecast: "
                    f"predicted {predicted:.1f}{sensor.unit}, "
                    f"got {sensor.value:.1f}{sensor.unit} "
                    f"(score: {anomaly_score:.2f}σ)"
                )

            # Only include verdicts that are noteworthy
            if is_anomaly or sensor.sensorId in DEPENDENCY_GRAPH.get(
                building.buildingId, {}
            ).get("critical_sensors", []):
                verdicts.append(AnomalyVerdict(
                    buildingId=building.buildingId,
                    sensorId=sensor.sensorId,
                    chronosAnomaly=is_anomaly,
                    dependencyRisk=False,  # Set below
                    verdict=verdict,
                    explanation=explanation,
                    predictedValue=round(predicted, 2),
                    actualValue=round(sensor.value, 2),
                    anomalyScore=anomaly_score,
                ))

            # Track worst alert level for this building
            if verdict == "critical":
                building_worst = "critical"
            elif verdict == "warning" and building_worst != "critical":
                building_worst = "warning"

        building_alerts[building.buildingId] = building_worst

    # Run dependency cascade analysis
    dependency_alerts = analyze_dependency_cascade(building_alerts)

    # Mark dependency-risk verdicts
    at_risk_buildings = {a["affectedBuilding"] for a in dependency_alerts}
    for v in verdicts:
        if v.buildingId in at_risk_buildings:
            v.dependencyRisk = True

    # Overall health
    if any(v.verdict == "critical" for v in verdicts) or \
       any(a["severity"] == "critical" for a in dependency_alerts):
        overall = "critical"
    elif any(v.verdict == "warning" for v in verdicts) or dependency_alerts:
        overall = "degraded"
    else:
        overall = "healthy"

    return AnalyzeResponse(
        stationId=request.stationId,
        timestamp=int(time.time() * 1000),
        verdicts=verdicts,
        dependencyAlerts=dependency_alerts,
        overallHealth=overall,
    )


@app.get("/dependency-graph")
async def get_dependency_graph():
    """Return the station dependency graph for visualization."""
    nodes = []
    edges = []

    for building_id, info in DEPENDENCY_GRAPH.items():
        nodes.append({
            "id": building_id,
            "name": BUILDING_NAMES.get(building_id, building_id),
            "criticalSensors": info.get("critical_sensors", []),
            "description": info.get("description", ""),
        })

        for dep_id in info.get("dependents", []):
            edges.append({
                "source": building_id,
                "target": dep_id,
                "label": "powers" if building_id == "generator" else "feeds",
            })

    return {"nodes": nodes, "edges": edges}


@app.get("/predictions")
async def get_predictions():
    """Return current Chronos forecaster predictions for all tracked sensors."""
    predictions = {}
    for key, state in chronos.states.items():
        parts = key.split(".", 1) if "." in key else (key, key)
        building_id, sensor_id = parts[0], parts[1] if len(parts) > 1 else parts[0]
        if building_id not in predictions:
            predictions[building_id] = {}

        # State is a tuple: (level, trend)
        level, trend = state
        predicted = level + trend

        # Get actual from history
        hist = chronos.history.get(key, [])
        actual = hist[-1] if hist else level

        # Compute std from history
        if len(hist) > 5:
            mean_val = sum(hist) / len(hist)
            variance = sum((x - mean_val) ** 2 for x in hist) / len(hist)
            std = math.sqrt(variance) if variance > 0 else 1
        else:
            profile = SENSOR_PROFILES.get(sensor_id, {})
            std = profile.get("std", 1)

        anomaly_score = abs(actual - predicted) / std if std > 0 else 0

        predictions[building_id][sensor_id] = {
            "predicted": round(predicted, 2),
            "actual": round(actual, 2),
            "confidence_low": round(predicted - 2 * std, 2),
            "confidence_high": round(predicted + 2 * std, 2),
            "anomaly_score": round(anomaly_score, 2),
            "is_anomaly": anomaly_score > 2,
            "std": round(std, 3),
        }

    return {
        "predictions": predictions,
        "forecasterCount": len(chronos.states),
        "timestamp": int(time.time() * 1000),
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "UP",
        "service": "aurora-ai",
        "forecasterStates": len(chronos.states),
    }


if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("  Aurora — AI Anomaly Detection Service")
    print("  Port: 8000")
    print("=" * 60)
    uvicorn.run(app, host=HOST, port=8000, log_level="info")
