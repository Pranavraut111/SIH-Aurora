"""Validation & error hygiene (C): constrained POST bodies (422/404), simulator
control routes never fall back to Maitri, and static proofs — no silent
excepts, no utcnow, no print() in service code, no empty JS catch blocks."""

import ast
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SIM_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = SIM_DIR.parent / "src"

# Long-running services (CLI scripts / self-tests may print to the terminal).
SERVICE_MODULES = [
    "unified_backend.py", "simulator.py", "alert_engine.py", "analytics_ai_engine.py", "anomaly_engine.py",
    "cascade.py", "chronos_forecaster.py", "config.py", "db.py", "decision_engine.py", "decision_scheduler.py",
    "forecast_engine.py", "ncpor_ingestor.py", "offline_explain.py", "physics_model.py", "station_config.py",
    "station_store.py", "twin_inspector.py", "units.py", "validation.py", "weather_data.py",
]
CLI_FUNCTIONS = {"main"}          # anomaly_engine.main() is the offline training CLI


@pytest.fixture
def client(temp_db):
    import unified_backend as ub
    with TestClient(ub.app) as c:
        yield c


def _post(c, path, body):
    return c.post(path, content=json.dumps(body, allow_nan=True), headers={"Content-Type": "application/json"})


# ── request validation ────────────────────────────────────────

@pytest.mark.parametrize("body,code", [
    ({"stationId": "maitri", "scenarioId": "blizzard", "intensity": 1.0}, 200),
    ({"stationId": "maitri", "scenarioId": "zombie_attack"}, 422),
    ({"stationId": "maitri", "scenarioId": "blizzard", "intensity": 5}, 422),
    ({"stationId": "maitri", "scenarioId": "blizzard", "intensity": float("inf")}, 422),
    ({"stationId": "atlantis", "scenarioId": "blizzard"}, 404),
    ({"stationId": "maitri", "scenarioId": "blizzard", "extra": True}, 422),
])
def test_whatif_validation(client, body, code):
    assert _post(client, "/api/simulation/whatif", body).status_code == code


@pytest.mark.parametrize("body", [
    {"mode": "turbo"}, {"date": "2024-02-31"}, {"date": "15/07/2024"}, {"speed": 0}, {"speed": 99999},
    {"mode": "reanalysis", "unexpected": 1},
])
def test_mode_validation(client, body):
    assert _post(client, "/api/sim/mode", body).status_code == 422


@pytest.mark.parametrize("body,code", [
    ({"station": "maitri", "question": "why"}, 200),
    ({"station": "maitri", "question": "why; DROP"}, 422),
    ({"station": "maitri", "freeText": "x" * 2001}, 422),
    ({"station": "maitri", "unknown": 1}, 422),
    ({"station": "atlantis"}, 404),
])
def test_explain_validation(client, body, code):
    assert _post(client, "/api/aurora-explain", body).status_code == code


def test_sensor_batch_and_inject_validation(client):
    ok = {"stationId": "maitri", "readings": {"generator": {"gen_temp": {"value": 60.0}}}}
    assert _post(client, "/api/sensors/batch", ok).status_code == 200
    bad_value = {"stationId": "maitri", "readings": {"generator": {"gen_temp": {"value": float("nan")}}}}
    assert _post(client, "/api/sensors/batch", bad_value).status_code == 422          # JSON-safe 422, not 500
    too_many = {"stationId": "maitri", "readings": {f"b{i}": {} for i in range(21)}}
    assert _post(client, "/api/sensors/batch", too_many).status_code == 422
    assert _post(client, "/api/sensors/batch", {**ok, "stationId": "atlantis"}).status_code == 404
    assert client.post("/api/sim/inject/DROP%20TABLE?stationId=maitri").status_code == 422


def test_422_response_is_json_and_omits_raw_input(client):
    r = _post(client, "/api/logistics/update", {"stationId": "maitri", "itemId": "maitri-fuel",
                                                "current": float("nan"), "updatedBy": "ops"})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert isinstance(detail, list) and all("input" not in d for d in detail)


# ── simulator control routes: unknown station/scenario → 404 ──

@pytest.fixture(scope="module")
def sim_client():
    import simulator
    return simulator.control_app.test_client()


def test_simulator_routes_reject_unknown_station_and_scenario(sim_client):
    assert sim_client.get("/api/anomaly?station=atlantis").status_code == 404
    assert sim_client.post("/inject/generator_failure?station=atlantis").status_code == 404
    r = sim_client.post("/inject/zombie_attack?station=bharati")
    assert r.status_code == 404 and "Unknown scenario" in r.get_json()["detail"]
    assert sim_client.post("/mode", json={"mode": "turbo"}).status_code == 422
    assert sim_client.post("/mode", json={"date": "2024-13-01"}).status_code == 422
    assert sim_client.post("/inject-single", json={"stationId": "maitri", "target": "x"}).status_code == 422
    assert sim_client.post("/inject-single", json={"stationId": "maitri", "buildingId": "nope",
                                                   "sensorId": "nope", "target": 1}).status_code == 404


# ── static proofs ─────────────────────────────────────────────

def _python_files():
    files = [p for p in SIM_DIR.glob("*.py")]
    files += list((SIM_DIR / "migrations").glob("*.py")) + list((SIM_DIR / "tests").glob("*.py"))
    return files


def test_no_bare_or_silent_except_in_python():
    offenders = []
    for path in _python_files():
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler):
                if node.type is None:
                    offenders.append(f"{path.name}:{node.lineno} bare except")
                elif all(isinstance(stmt, ast.Pass) for stmt in node.body):
                    offenders.append(f"{path.name}:{node.lineno} except ...: pass")
    assert not offenders, offenders


def test_no_naive_utc_datetime_calls():
    pattern = re.compile(r"\butc(now|fromtimestamp)\s*\(")
    hits = [f"{p.name}:{i}" for p in _python_files() if p.name != "test_validation.py"
            for i, line in enumerate(p.read_text().splitlines(), 1) if pattern.search(line)]
    assert not hits, hits


def test_no_print_in_service_code():
    offenders = []
    for name in SERVICE_MODULES:
        tree = ast.parse((SIM_DIR / name).read_text())

        def visit(node, allowed):
            for child in ast.iter_child_nodes(node):
                ok = allowed
                if isinstance(child, ast.If) and getattr(getattr(child.test, "left", None), "id", "") == "__name__":
                    ok = True
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and child.name in CLI_FUNCTIONS \
                        and name == "anomaly_engine.py":
                    ok = True
                if isinstance(child, ast.Call) and getattr(child.func, "id", "") == "print" and not ok:
                    offenders.append(f"{name}:{child.lineno}")
                visit(child, ok)

        visit(tree, False)
    assert not offenders, offenders


def test_no_empty_or_comment_only_catch_in_js():
    offenders = []
    for path in list(SRC_DIR.rglob("*.js")) + list(SRC_DIR.rglob("*.jsx")):
        text = path.read_text()
        for m in re.finditer(r"catch\s*(\([^)]*\))?\s*\{", text):
            depth, j = 1, m.end()
            while depth and j < len(text):
                depth += {"{": 1, "}": -1}.get(text[j], 0)
                j += 1
            body = re.sub(r"/\*.*?\*/|//[^\n]*", "", text[m.end():j - 1], flags=re.S).strip()
            if not body:
                offenders.append(f"{path.relative_to(SRC_DIR)}:{text[:m.start()].count(chr(10)) + 1}")
        offenders += [f"{path.relative_to(SRC_DIR)} .catch(()=>{{}})"
                      for _ in re.finditer(r"\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)", text)]
    assert not offenders, offenders


def test_legacy_simulator_env_is_not_read(monkeypatch):
    """E: config.py loads ONLY the root .env; simulator/.env is never passed to load_dotenv."""
    import importlib
    import dotenv
    import config as app_config
    loaded = []
    monkeypatch.setattr(dotenv, "load_dotenv", lambda path=None, **kw: loaded.append(Path(path)) or True)
    try:
        importlib.reload(app_config)
        assert loaded == [app_config.REPO_ROOT / ".env"]
        assert app_config.SIM_DIR / ".env" not in loaded
    finally:
        monkeypatch.undo()
        importlib.reload(app_config)
