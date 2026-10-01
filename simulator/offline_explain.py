"""
Aurora — deterministic "offline summary" explanations (no LLM).

Used by unified_backend.py /api/aurora-explain when GROQ_API_KEY is not set or
the LLM / simulator is unreachable. Every sentence is built from fields of the
current decision JSON (simulator decision engine) and the published telemetry
snapshot — nothing is invented. Different questions route to different
intents, so they get different, relevant answers.
"""

import re

OFFLINE_LABEL = "Offline summary (LLM unavailable)"

INTENT_KEYWORDS = [
    ("why", r"\bwhy\b|cause|reason|explain"),
    ("action", r"\bdo\b|should|action|recommend|fix|mitigat|next step"),
    ("fuel", r"fuel|diesel|autonomy|tank"),
    ("weather", r"wind|weather|temperature|cold|blizzard|storm"),
    ("generator", r"generator|power|rpm|engine|load"),
    ("forecast", r"forecast|predict|tomorrow|next hour|coming|trend"),
]
QUESTION_TYPES = {"status", "why", "action", "detail"}


def classify(question: str, free_text: str) -> str:
    q = (question or "").strip().lower()
    if q in QUESTION_TYPES:
        return q
    text = (free_text or "").lower()
    for intent, pattern in INTENT_KEYWORDS:
        if re.search(pattern, text):
            return intent
    return "status"


def _num(v, unit="", nd=1):
    return "unknown" if v is None else f"{round(float(v), nd)}{unit}"


def _sensor(snapshot, bld, key):
    return ((snapshot or {}).get("sensors") or {}).get(bld, {}).get(key)


def _event_line(decision):
    ev = decision.get("event") or {}
    risk = (decision.get("risk") or {}).get("level", "unknown")
    line = f"Decision engine: {ev.get('description', 'no event')} (risk level: {risk})."
    rr = decision.get("recentlyResolved")
    if rr:
        line += (f" Recently resolved {rr.get('resolvedSecondsAgo')} s ago: "
                 f"{(rr.get('event') or {}).get('type', '').replace('_', ' ')} (was {rr.get('risk')}).")
    return line


def _evidence_lines(decision, limit=3):
    out = []
    for ev in [e for e in decision.get("evidence", []) if e.get("type") == "anomaly_evidence"][:limit]:
        out.append(f"{ev.get('sensor')} = {ev.get('value')} vs physics-expected {ev.get('expected')} ({ev.get('deviation')}).")
    return out


def offline_explanation(decision, question: str, free_text: str, station: str, snapshot=None) -> dict:
    intent = classify(question, free_text)
    lines = []
    if decision is None:
        lines.append("The simulator's decision engine is unavailable, so no risk assessment can be summarised.")
    if intent in ("status", "detail") and decision:
        lines.append(_event_line(decision))
        cs = decision.get("currentState") or {}
        lines.append(f"Generator at {_num(cs.get('gen_load_pct'), '%')} load, {_num(cs.get('gen_temp_C'), ' °C')}, "
                     f"fuel {_num(cs.get('fuel_rate_Lhr'), ' L/hr')}; outside {_num(cs.get('env_temp'), ' °C')}.")
        if intent == "detail":
            lines += _evidence_lines(decision)
            fc = decision.get("forecast") or {}
            if fc.get("available"):
                lines.append(f"Physics forecast: temperature change {_num(fc.get('temperature_change'), ' °C')}, "
                             f"load change {_num(fc.get('load_change_pp'), ' pp')}, "
                             f"generator {_num(fc.get('gen_temp_predicted_24h'), ' °C')} at the last horizon.")
    elif intent == "why" and decision:
        rules = (decision.get("risk") or {}).get("triggered_rules") or []
        if rules:
            lines.append("Risk rules triggered: " + "; ".join(f"{r['id']} {r['name']} — {r['rationale']}" for r in rules))
        else:
            lines.append("No risk rules are currently triggered.")
        ev = _evidence_lines(decision)
        lines += ev if ev else ["No sensor deviates from the physics prediction by 3σ or more."]
    elif intent == "action" and decision:
        rec = decision.get("recommendation") or {}
        lines.append(f"Recommended action: {rec.get('action', 'none')}.")
        lines.append(f"Monitoring: {rec.get('monitoring', 'n/a')}. Escalation: {rec.get('escalation', 'n/a')}.")
        lines.append(f"Action type: {rec.get('action_type', 'n/a')}; confidence: {rec.get('confidence', 'n/a')}. "
                     "No automated action is taken without operator approval.")
    elif intent == "fuel":
        fuel_rate = _sensor(snapshot, "generator", "gen_fuel_rate")
        store = _sensor(snapshot, "storage", "store_fuel")
        lines.append(f"Generator fuel burn {_num(fuel_rate, ' L/hr')} (model-derived); "
                     f"fuel store {_num(store, ' kL')} (model-derived running state).")
        if fuel_rate and store:
            lines.append(f"At this burn rate the store lasts about {round(store * 1000 / (fuel_rate * 24))} days.")
    elif intent == "weather":
        lines.append(f"Outside temperature {_num(_sensor(snapshot, 'lab', 'env_temp'), ' °C')}, "
                     f"wind {_num(_sensor(snapshot, 'lab', 'env_wind'), ' km/h')}, "
                     f"pressure {_num(_sensor(snapshot, 'lab', 'env_pressure'), ' hPa')} "
                     f"(source: {((snapshot or {}).get('provenance') or {}).get('weatherSource', 'unknown')}).")
    elif intent == "generator":
        lines.append(f"Generator power {_num(_sensor(snapshot, 'generator', 'gen_power'), ' kW')}, "
                     f"{_num(_sensor(snapshot, 'generator', 'gen_rpm'), ' rpm', 0)}, "
                     f"coolant {_num(_sensor(snapshot, 'generator', 'gen_temp'), ' °C')}.")
        if decision:
            lines += _evidence_lines(decision) or ["Generator readings match the physics prediction (no ≥3σ residuals)."]
    elif intent == "forecast" and decision:
        fc = decision.get("forecast") or {}
        if fc.get("available"):
            lines.append(f"Physics forecast (live Open-Meteo weather): temperature change {_num(fc.get('temperature_change'), ' °C')}, "
                         f"generator load change {_num(fc.get('load_change_pp'), ' pp')}, "
                         f"generator {_num(fc.get('gen_temp_predicted_24h'), ' °C')} at the last horizon.")
        else:
            lines.append("The physics forecast is currently unavailable (no forecast weather).")
    if not lines:
        lines.append("No data available to summarise.")
    return {
        "explanation": f"**{OFFLINE_LABEL} — {station.upper()}, {intent}**\n\n" + "\n".join(f"• {l}" for l in lines),
        "intent": intent,
        "llmAvailable": False,
        "mode": "offline-summary",
    }
