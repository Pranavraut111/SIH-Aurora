#!/usr/bin/env python3
"""
Aurora v3 — Phase 5: Decision/Outcome Engine

Architecture:
    Current state → Physics twin
    Anomaly v2    → Evidence + candidate causes
    Forecast      → Predicted future states + weather
                        ↓
                 Dependency Graph
                        ↓
                 Outcome Engine
            ┌───────────┼───────────┐
            ↓           ↓           ↓
          Cause       Impact       Risk
            ↓           ↓           ↓
            └───────────┼───────────┘
                        ↓
                 Recommendation
                        ↓
                   Audit Trail

Every statement is traceable to an input.
The engine does NOT invent information — it combines validated outputs
from the physics model, anomaly detector, and forecast engine into
structured decisions with provenance.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

sys.path.insert(0, os.path.dirname(__file__))

import station_config  # noqa: E402

log = logging.getLogger("aurora.decision")

# ═══════════════════════════════════════════════════════
#  Dependency graph — what affects what
# ═══════════════════════════════════════════════════════

# Abstract causal graph — from station_config.json (single source of truth).
DEPENDENCY_GRAPH = station_config.decision_causal_graph()

# ═══════════════════════════════════════════════════════
#  Risk matrix — explicit, auditable rules
# ═══════════════════════════════════════════════════════

RISK_RULES: list[dict[str, Any]] = [
    {
        "id": "R001",
        "name": "Anomaly during load increase",
        "condition": lambda ctx: (
            ctx.get("anomaly_active") and
            ctx.get("forecast_load_delta", 0) > 3
        ),
        "severity": "high",
        "weight": 0.35,
        "rationale": "Active equipment anomaly combined with predicted load increase "
                     "may accelerate degradation.",
    },
    {
        "id": "R002",
        "name": "Cold front approaching",
        "condition": lambda ctx: ctx.get("forecast_temp_delta", 0) < -8,
        "severity": "moderate",
        "weight": 0.20,
        "rationale": "Significant temperature drop will increase heating demand "
                     "and generator loading.",
    },
    {
        "id": "R003",
        "name": "Generator thermal margin",
        "condition": lambda ctx: ctx.get("gen_temp_C", 0) > 70,
        "severity": "moderate",
        "weight": 0.15,
        "rationale": "Generator operating above 70°C has reduced thermal margin.",
    },
    {
        "id": "R004",
        "name": "Forecast generator temperature",
        "condition": lambda ctx: ctx.get("forecast_gen_temp_24h", 0) > 75,
        "severity": "high",
        "weight": 0.20,
        "rationale": "Generator temperature predicted to exceed 75°C within 24 hours.",
    },
    {
        "id": "R005",
        "name": "Anomaly without load change",
        "condition": lambda ctx: (
            ctx.get("anomaly_active") and
            abs(ctx.get("forecast_load_delta", 0)) < 2
        ),
        "severity": "moderate",
        "weight": 0.10,
        "rationale": "Equipment anomaly detected under stable load conditions.",
    },
]

# ═══════════════════════════════════════════════════════
#  Response templates
# ═══════════════════════════════════════════════════════

RESPONSE_TEMPLATES = {
    "cooling_degradation": {
        "action": "Inspect generator cooling system performance",
        "monitoring": "Monitor generator temperature every 15 minutes",
        "escalation": "If temperature exceeds 80°C, reduce non-essential load",
        "action_type": "operator_review",
    },
    "fuel_system_degradation": {
        "action": "Check fuel injection system and filters",
        "monitoring": "Monitor fuel consumption rate for continued deviation",
        "escalation": "If fuel consumption exceeds 120% of expected, inspect injectors",
        "action_type": "operator_review",
    },
    "bearing_wear": {
        "action": "Check generator bearings and vibration levels",
        "monitoring": "Monitor RPM stability and generator temperature",
        "escalation": "If RPM drops below 1400, schedule maintenance",
        "action_type": "maintenance_review",
    },
    "heating_degradation": {
        "action": "Inspect heating system output capacity",
        "monitoring": "Monitor indoor temperatures across all buildings",
        "escalation": "If indoor temperatures drop below 15°C, activate backup heating",
        "action_type": "operator_review",
    },
    "generator_output_loss": {
        "action": "Check generator output, governor and load transfer; prepare backup generator",
        "monitoring": "Monitor generator power and RPM every 5 minutes",
        "escalation": "If output stays below physics prediction, start backup generator and shed non-essential load",
        "action_type": "operator_review",
    },
    "ventilation_degradation": {
        "action": "Inspect living-quarters ventilation (fans, intakes, filters)",
        "monitoring": "Monitor CO2 and humidity in living quarters every 5 minutes",
        "escalation": "If CO2 exceeds 1500 ppm, increase fresh-air intake and limit occupancy",
        "action_type": "operator_review",
    },
    "cold_front": {
        "action": "Verify heating system readiness and fuel reserves",
        "monitoring": "Monitor ambient temperature and heating demand",
        "escalation": "If generator load exceeds 60%, consider load shedding",
        "action_type": "preparedness_check",
    },
    "normal": {
        "action": "No action required",
        "monitoring": "Continue standard monitoring",
        "escalation": "N/A",
        "action_type": "routine",
    },
}


class DecisionEngine:
    """Combines physics state, anomaly detection, and forecast into
    structured decisions with full audit trail.

    Every output statement traces back to a specific input.
    The engine does NOT generate opinions — it evaluates rules
    against measured and predicted states.
    """

    def __init__(self, station_id: str):
        self.station_id = station_id

    def evaluate(self, current_state: dict, anomaly_result: dict,
                 forecast_result: dict | None = None) -> dict:
        """Produce a structured decision from all available information.

        Args:
            current_state: Current physics model readings + weather
            anomaly_result: Output from anomaly detector v2
            forecast_result: Output from forecast engine

        Returns:
            Structured decision with event, evidence, forecast,
            impact, risk, recommendation, and audit trail.
        """
        audit: list[dict[str, Any]] = []

        # ── 1. Extract current state ────────────────────────
        weather = current_state.get("weather", {})
        gen = current_state.get("generator", {})
        meta = current_state.get("meta", {})

        current_temp = weather.get("env_temp", -20)
        current_wind = weather.get("env_wind", 30)
        gen_load = meta.get("gen_load_pct", 35)
        gen_temp = self._extract_val(gen.get("gen_temp", 0))
        fuel_rate = self._extract_val(gen.get("gen_fuel_rate", 0))
        gen_rpm = self._extract_val(gen.get("gen_rpm", 1500))

        audit.append({
            "step": "current_state",
            "source": "physics_model",
            "provenance": "model-derived from reanalysis weather",
            "data": {
                "env_temp": current_temp,
                "env_wind": current_wind,
                "gen_load_pct": round(gen_load, 1),
                "gen_temp_C": round(gen_temp, 1),
                "fuel_rate_Lhr": round(fuel_rate, 1),
                "gen_rpm": round(gen_rpm, 0),
            },
        })

        # ── 2. Anomaly assessment ────────────────────────────
        anomaly_active = False
        anomaly_score = 0
        candidate_cause = None
        evidence_sensors = []

        if anomaly_result and anomaly_result.get("is_anomaly"):
            anomaly_active = True
            anomaly_score = anomaly_result.get("anomaly_score", 0)
            causes = anomaly_result.get("candidateCauses", [])
            if causes:
                candidate_cause = causes[0].get("cause", "unknown")
            evidence_sensors = [
                e["sensor"] for e in anomaly_result.get("evidence", [])
            ]

        audit.append({
            "step": "anomaly_assessment",
            "source": "anomaly_detector_v2",
            "provenance": "Isolation Forest trained on normal states only",
            "data": {
                "anomaly_active": anomaly_active,
                "anomaly_score": anomaly_score,
                "scoreType": anomaly_result.get("scoreType", "N/A") if anomaly_result else "N/A",
                "candidate_cause": candidate_cause,
                "evidence_sensors": evidence_sensors,
            },
        })

        # ── 3. Forecast assessment ───────────────────────────
        forecast_temp_delta = 0
        forecast_load_delta = 0
        forecast_gen_temp_24h = gen_temp
        forecast_available = False

        if forecast_result and forecast_result.get("available"):
            forecast_available = True
            preds = forecast_result.get("predictions", [])

            if preds:
                last_pred = preds[-1]
                first_pred = preds[0]

                # Compare against the forecast's own baseline when provided: in replay
                # mode the live forecast is not time-aligned with replayed weather.
                base_temp = forecast_result.get("comparisonBaseTemp")
                if base_temp is None:
                    base_temp = current_temp
                future_temp = last_pred.get("weather", {}).get("env_temp", base_temp)
                forecast_temp_delta = future_temp - base_temp

                forecast_load_delta = (
                    last_pred["predicted"]["gen_load_pct"] -
                    first_pred["predicted"]["gen_load_pct"]
                )
                forecast_gen_temp_24h = last_pred["predicted"]["gen_temp_C"]

        audit.append({
            "step": "forecast_assessment",
            "source": "forecast_engine",
            "provenance": "Physics twin forward run with Open-Meteo forecast weather",
            "data": {
                "forecast_available": forecast_available,
                "temperature_delta": round(forecast_temp_delta, 1),
                "load_delta_pp": round(forecast_load_delta, 1),
                "predicted_gen_temp_24h": round(forecast_gen_temp_24h, 1),
            },
        })

        # ── 4. Build risk context ────────────────────────────
        ctx = {
            "anomaly_active": anomaly_active,
            "anomaly_score": anomaly_score,
            "candidate_cause": candidate_cause,
            "gen_temp_C": gen_temp,
            "gen_load_pct": gen_load,
            "forecast_temp_delta": forecast_temp_delta,
            "forecast_load_delta": forecast_load_delta,
            "forecast_gen_temp_24h": forecast_gen_temp_24h,
        }

        # ── 5. Evaluate risk rules ───────────────────────────
        triggered_rules = []
        total_weight = 0

        for rule in RISK_RULES:
            try:
                if rule["condition"](ctx):
                    triggered_rules.append({
                        "id": rule["id"],
                        "name": rule["name"],
                        "severity": rule["severity"],
                        "weight": rule["weight"],
                        "rationale": rule["rationale"],
                    })
                    total_weight += rule["weight"]
            except Exception:
                # A rule that cannot be evaluated is skipped, never silently: it is a bug in the rule
                # or missing context, and the audit trail would otherwise under-report risk.
                log.warning("Risk rule %s could not be evaluated; skipped", rule["id"], exc_info=True)

        # Determine overall risk level
        if total_weight >= 0.5:
            risk_level = "high"
        elif total_weight >= 0.2:
            risk_level = "moderate"
        elif triggered_rules:
            risk_level = "low"
        else:
            risk_level = "nominal"

        audit.append({
            "step": "risk_evaluation",
            "source": "decision_engine_rules",
            "provenance": "Rule-based risk matrix (explicit, auditable)",
            "data": {
                "triggered_rules": [r["id"] for r in triggered_rules],
                "total_weight": round(total_weight, 2),
                "risk_level": risk_level,
            },
        })

        # ── 6. Build event description ───────────────────────
        if anomaly_active and candidate_cause:
            event_type = candidate_cause
            cause_desc = RESPONSE_TEMPLATES.get(
                candidate_cause, RESPONSE_TEMPLATES["normal"]
            )
            event_desc = f"Possible {candidate_cause.replace('_', ' ')}"
        elif forecast_temp_delta < -8:
            event_type = "cold_front"
            cause_desc = RESPONSE_TEMPLATES["cold_front"]
            event_desc = f"Cold front approaching ({forecast_temp_delta:+.1f}°C forecast)"
        else:
            event_type = "normal"
            cause_desc = RESPONSE_TEMPLATES["normal"]
            event_desc = "Normal operations"

        # ── 7. Build evidence list ───────────────────────────
        evidence = []

        if anomaly_active:
            for ev in (anomaly_result or {}).get("evidence", [])[:4]:
                evidence.append({
                    "type": "anomaly_evidence",
                    "sensor": ev["sensor"],
                    "value": ev["value"],
                    "expected": ev["expected"],
                    "deviation": f"{ev['deviation_sigma']:+.1f}σ",
                    "source": "anomaly_detector_v2",
                })

        if forecast_available and forecast_result is not None:
            preds = forecast_result.get("predictions", [])
            for p in preds:
                if p["hours_ahead"] in [1, 6, 24]:
                    evidence.append({
                        "type": "forecast_prediction",
                        "horizon": p["horizon"],
                        "predicted_temp": p["weather"].get("env_temp"),
                        "predicted_load": p["predicted"]["gen_load_pct"],
                        "predicted_gen_temp": p["predicted"]["gen_temp_C"],
                        "source": "forecast_engine",
                    })

        # ── 8. Build impact assessment ───────────────────────
        impact_statements = []

        if forecast_temp_delta < -5:
            impact_statements.append({
                "system": "heating",
                "statement": ("Heating demand expected to increase as temperature drops "
                              f"{abs(forecast_temp_delta):.1f}°C"),
                "source": "forecast + dependency_graph",
                "dependency_chain": ["weather", "heating", "power_demand", "generator"],
            })

        if forecast_load_delta > 3:
            impact_statements.append({
                "system": "generator",
                "statement": f"Generator load increasing from {gen_load:.1f}% to {gen_load + forecast_load_delta:.1f}%",
                "source": "forecast_engine",
                "dependency_chain": ["power_demand", "generator", "fuel"],
            })

        if anomaly_active and candidate_cause == "cooling_degradation":
            impact_statements.append({
                "system": "generator",
                "statement": "Generator cooling efficiency reduced; thermal margin decreasing",
                "source": "anomaly_detector_v2",
                "dependency_chain": ["cooling", "generator"],
            })

        if anomaly_active and candidate_cause == "bearing_wear":
            impact_statements.append({
                "system": "generator",
                "statement": "Generator bearing wear detected; RPM instability possible",
                "source": "anomaly_detector_v2",
                "dependency_chain": ["generator"],
            })

        # ── 9. Build recommendation ──────────────────────────
        recommendation = {
            "action": cause_desc["action"],
            "monitoring": cause_desc["monitoring"],
            "escalation": cause_desc["escalation"],
            "action_type": cause_desc["action_type"],
            "confidence": self._confidence_label(anomaly_score, risk_level),
        }

        audit.append({
            "step": "recommendation",
            "source": "decision_engine",
            "provenance": "Template-based recommendation from risk evaluation",
            "data": recommendation,
        })

        # ── 10. Assemble final decision ──────────────────────
        return {
            "stationId": self.station_id,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "event": {
                "type": event_type,
                "description": event_desc,
            },
            "currentState": {
                "env_temp": round(current_temp, 1),
                "env_wind": round(current_wind, 1),
                "gen_load_pct": round(gen_load, 1),
                "gen_temp_C": round(gen_temp, 1),
                "fuel_rate_Lhr": round(fuel_rate, 1),
            },
            "evidence": evidence,
            "forecast": {
                "available": forecast_available,
                "temperature_change": round(forecast_temp_delta, 1),
                "load_change_pp": round(forecast_load_delta, 1),
                "gen_temp_predicted_24h": round(forecast_gen_temp_24h, 1),
            },
            "impact": impact_statements,
            "risk": {
                "level": risk_level,
                "triggered_rules": triggered_rules,
                "total_weight": round(total_weight, 2),
            },
            "recommendation": recommendation,
            "auditTrail": audit,
            "provenance": {
                "weather": "ERA5 reanalysis (current) + Open-Meteo forecast (future)",
                "physics": "Aurora digital twin (model-derived)",
                "anomaly": "Isolation Forest v2 (19 features, normal-only training)",
                "forecast": "Physics twin forward run (validated: sub-1°C MAE)",
                "decision": "Rule-based risk matrix (explicit, auditable)",
                "note": "All degradation assessments are against synthetic "
                        "prototype signatures. No automated action without "
                        "operator approval.",
            },
        }

    def _extract_val(self, v):
        if isinstance(v, dict):
            return v.get("value", 0)
        return v or 0

    def _confidence_label(self, anomaly_score: float, risk_level: str) -> str:
        if anomaly_score > 0.7:
            return "high"
        elif anomaly_score > 0.5 and risk_level in ("high", "moderate"):
            return "moderate"
        elif anomaly_score > 0.45:
            return "low"
        return "informational"


# ═══════════════════════════════════════════════════════
#  Standalone test
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    engine = DecisionEngine("maitri")

    # Simulated inputs
    current = {
        "weather": {"env_temp": -12.5, "env_wind": 43.1},
        "generator": {
            "gen_temp": {"value": 58.6},
            "gen_fuel_rate": {"value": 15.3},
            "gen_rpm": {"value": 1490},
        },
        "meta": {"gen_load_pct": 34.7},
    }

    # v3 anomaly output: "expected" is the physics prediction for the same tick
    anomaly = {
        "anomaly_score": 0.61,
        "scoreType": "isolation_forest_path_score",
        "threshold": 0.554,
        "triggeredBy": ["isolation_forest", "residual_z"],
        "is_anomaly": True,
        "evidence": [
            {"sensor": "gen_temp", "value": 64.9, "expected": 58.6, "residual": 6.3,
             "deviation_sigma": 12.6, "direction": "above", "contribution": 12.6,
             "expectedSource": "physics model prediction (same tick)"},
        ],
        "candidateCauses": [
            {"cause": "cooling_degradation", "confidence": 1.0,
             "description": "Possible generator cooling system degradation",
             "matchingSensors": ["gen_temp"]},
        ],
    }

    forecast = {
        "available": True,
        "predictions": [
            {"horizon": "+1hr", "hours_ahead": 1, "weather": {"env_temp": -15.9},
             "predicted": {"gen_load_pct": 36.2, "gen_temp_C": 62.6, "fuel_rate_Lhr": 15.4}},
            {"horizon": "+6hr", "hours_ahead": 6, "weather": {"env_temp": -21.3},
             "predicted": {"gen_load_pct": 38.8, "gen_temp_C": 64.5, "fuel_rate_Lhr": 16.1}},
            {"horizon": "+24hr", "hours_ahead": 24, "weather": {"env_temp": -23.6},
             "predicted": {"gen_load_pct": 40.7, "gen_temp_C": 66.7, "fuel_rate_Lhr": 16.9}},
        ],
    }

    result = engine.evaluate(current, anomaly, forecast)

    print(json.dumps(result, indent=2, default=str))

    # Pretty summary
    print(f"\n{'='*60}")
    print(f"  DECISION ENGINE OUTPUT — {result['stationId'].upper()}")
    print(f"{'='*60}")
    print(f"\n  EVENT: {result['event']['description']}")
    print(f"  RISK:  {result['risk']['level'].upper()}")
    print("\n  EVIDENCE:")
    for ev in result["evidence"]:
        if ev["type"] == "anomaly_evidence":
            print(f"    {ev['sensor']:22s}: {ev['value']:>8.1f} "
                  f"(expected {ev['expected']:>8.1f}, {ev['deviation']})")
        elif ev["type"] == "forecast_prediction":
            print(f"    {ev['horizon']:>8s}: temp={ev.get('predicted_temp', '?'):>6}°C  "
                  f"load={ev['predicted_load']:>5.1f}%  "
                  f"gen={ev['predicted_gen_temp']:>5.1f}°C")
    print("\n  IMPACT:")
    for imp in result["impact"]:
        print(f"    [{imp['system']}] {imp['statement']}")
        print(f"      chain: {' → '.join(imp['dependency_chain'])}")
    print("\n  TRIGGERED RISK RULES:")
    for r in result["risk"]["triggered_rules"]:
        print(f"    [{r['id']}] {r['name']} ({r['severity']}, weight={r['weight']})")
        print(f"      {r['rationale']}")
    print("\n  RECOMMENDATION:")
    rec = result["recommendation"]
    print(f"    Action:     {rec['action']}")
    print(f"    Monitor:    {rec['monitoring']}")
    print(f"    Escalation: {rec['escalation']}")
    print(f"    Type:       {rec['action_type']}")
    print(f"    Confidence: {rec['confidence']}")
    print(f"\n  AUDIT TRAIL: {len(result['auditTrail'])} steps")
    for step in result["auditTrail"]:
        print(f"    [{step['step']}] source={step['source']} "
              f"provenance={step['provenance'][:60]}")
