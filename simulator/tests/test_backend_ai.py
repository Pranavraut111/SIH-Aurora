"""Unified backend: real-pipeline proxies (503 when the simulator is down),
honest explanations, ONE twin-inspector schema, persisted+validated thresholds,
simulated remote dispatch, and removal of the fake /api/predictions."""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

DECISION = {
    "stationId": "bharati",
    "event": {"type": "generator_output_loss", "description": "Possible generator output loss"},
    "risk": {"level": "high", "triggered_rules": [
        {"id": "R005", "name": "Anomaly without load change", "rationale": "Equipment anomaly under stable load."}]},
    "evidence": [{"type": "anomaly_evidence", "sensor": "gen_rpm", "value": 1230.6, "expected": 1498.0, "deviation": "-53.5σ"}],
    "recommendation": {"action": "Check generator output", "monitoring": "Every 5 min", "escalation": "Start backup",
                       "action_type": "operator_review", "confidence": "high"},
    "currentState": {"env_temp": -12.0, "gen_load_pct": 34.0, "gen_temp_C": 71.0, "fuel_rate_Lhr": 15.0},
    "forecast": {"available": True, "temperature_change": -3.0, "load_change_pp": 1.2, "gen_temp_predicted_24h": 60.0},
}


@pytest.fixture
def client(temp_db):
    import unified_backend as ub
    with TestClient(ub.app) as c:
        yield c, ub


# ── removed / proxied endpoints ───────────────────────────────

def test_fake_predictions_endpoint_removed(client):
    c, _ = client
    assert c.get("/api/predictions?stationId=maitri").status_code == 404


@pytest.mark.parametrize("path", ["/api/ai/anomaly", "/api/ai/decision", "/api/ai/forecast", "/api/ai/chronos",
                                  "/api/sim/scenarios"])
def test_proxies_return_503_when_simulator_down(client, path):
    c, _ = client
    r = c.get(f"{path}?stationId=bharati")
    assert r.status_code == 503
    assert "Simulator offline" in r.json()["detail"]


def test_proxy_validates_station(client):
    c, _ = client
    assert c.get("/api/ai/anomaly?stationId=xyz").status_code == 404


def test_proxy_passes_simulator_data(client, monkeypatch):
    c, ub = client
    monkeypatch.setattr(ub, "_sim_request", lambda m, p, **k: {"isAnomaly": True, "path": p, "params": k.get("params")})
    r = c.get("/api/ai/anomaly?stationId=bharati").json()
    assert r["isAnomaly"] is True and r["path"] == "/api/anomaly" and r["params"] == {"station": "bharati"}
    assert r["source"] == "simulator"


# ── explanations ──────────────────────────────────────────────

def _explain(c, q, free=""):
    r = c.post("/api/aurora-explain", json={"station": "bharati", "question": q, "freeText": free})
    assert r.status_code == 200
    return r.json()


def test_offline_summary_when_simulator_down_differs_by_question(client):
    c, _ = client
    a = _explain(c, "free", "What is the fuel situation?")
    b = _explain(c, "free", "How windy is it outside?")
    assert a["llmAvailable"] is False and b["llmAvailable"] is False
    assert "Offline summary (LLM unavailable)" in a["explanation"]
    assert a["intent"] == "fuel" and b["intent"] == "weather"
    assert a["explanation"] != b["explanation"]
    assert "Simulator offline" in a["reason"]


def test_offline_summary_uses_decision_when_llm_unavailable(client, monkeypatch):
    c, ub = client

    def fake(method, path, **kw):
        if path == "/api/aurora-explain":
            return {"explanation": "LLM explanation unavailable: GROQ_API_KEY is not configured on the server.",
                    "llmAvailable": False}
        if path == "/api/decision":
            return DECISION
        raise HTTPException(503, "unexpected")

    monkeypatch.setattr(ub, "_sim_request", fake)
    why = _explain(c, "why")
    act = _explain(c, "action")
    assert why["explanation"] != act["explanation"]
    assert "R005" in why["explanation"] and "gen_rpm" in why["explanation"]
    assert "Check generator output" in act["explanation"]
    assert why["sources"] == ["decision_engine"] and "GROQ_API_KEY" in why["reason"]


def test_llm_answer_is_passed_through(client, monkeypatch):
    c, ub = client
    monkeypatch.setattr(ub, "_sim_request", lambda m, p, **k: {"explanation": "Groq says hi", "llmAvailable": True})
    r = _explain(c, "status")
    assert r["mode"] == "llm" and r["llmAvailable"] is True and r["explanation"] == "Groq says hi"


# ── twin inspector: one schema ────────────────────────────────

def test_twin_inspector_fallback_uses_the_one_schema(client):
    c, ub = client
    from twin_inspector import build_twin_inspector
    r = c.get("/api/twin-inspector?stationId=maitri")
    assert r.status_code == 200
    data = r.json()
    ref = build_twin_inspector(station_id="maitri", mode="x", tick_count=1, values={}, meta={},
                               params=ub.PHYSICS["maitri"].params, environment_source="x",
                               environment_source_type="x", simulated_time=None, data_source={},
                               telemetry_source="x")
    assert set(data) == set(ref)
    assert data["telemetrySource"] == "physics-fallback"
    for key in ("thermalModel", "powerBreakdown", "generatorModel", "modelAssumptions", "environment"):
        assert data[key], key
    assert data["generatorModel"]["power_kW"] is not None


# ── admin thresholds: persisted + validated ───────────────────

def test_thresholds_persist_and_validate(client):
    c, _ = client
    base = c.get("/api/admin/config").json()
    assert base["thresholds"]["generator_temp_critical"] == 95.0
    assert base["thresholdsUsedByAlerts"] is False

    ok = c.post("/api/admin/config", json={"thresholds": {"generator_temp_critical": 97.5}, "updatedBy": "test"})
    assert ok.status_code == 200 and ok.json()["thresholds"]["generator_temp_critical"] == 97.5
    again = c.get("/api/admin/config").json()
    assert again["thresholds"]["generator_temp_critical"] == 97.5            # persisted in SQLite
    assert again["thresholdsMeta"]["generator_temp_critical"]["updatedBy"] == "test"

    for bad in ({"generator_temp_critical": 500}, {"unknown_key": 1.0},
                {"wind_speed_warning_ms": 30.0, "wind_speed_critical_ms": 20.0},
                {"generator_temp_warning": 99.0}):                            # ≥ critical (97.5)
        r = c.post("/api/admin/config", json={"thresholds": bad})
        assert r.status_code == 422, bad
    assert c.get("/api/admin/config").json()["thresholds"]["generator_temp_critical"] == 97.5   # unchanged


# ── remote dispatch is labelled simulated ─────────────────────

def test_remote_dispatch_is_simulated(client):
    c, _ = client
    r = c.post("/api/remote/dispatch", json={"stationId": "maitri", "subsystem": "Power Grid",
                                             "command": "ENGAGE_BACKUP_GENSET_RUN", "issuedBy": "test operator"})
    body = r.json()
    assert body["status"] == "queued (simulated)" and body["simulated"] is True
    cmds = c.get("/api/remote/commands?stationId=maitri").json()["commands"]
    assert cmds[0]["status"] == "queued (simulated)" and cmds[0]["dispatched_at"] is None


def test_ncpor_live_reports_actual_dataset(client):
    c, _ = client
    w = c.get("/api/ncpor/live?stationId=maitri").json()["weather"]
    assert w["provenance"] in {"REAL", "REANALYSIS", "HARDCODED-DEMO"}
    assert w["dataset"] != "NCPOR Live Automatic Weather Station (AWS)"
    if w["provenance"] == "REAL":
        assert w["dataset"] == "NCPOR-AWS-Live"
