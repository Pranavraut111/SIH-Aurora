"""B3 — anomaly model v3: loads cleanly, no false positives on converged normal
states, detects every degradation/demo scenario, and has no train/serve skew."""

import ast
import re
import warnings
from pathlib import Path

import numpy as np
import pytest

import anomaly_engine as ae
import config as app_config
import evaluate_anomaly as ev

SIM_DIR = Path(__file__).resolve().parents[1]
STATIONS = ("maitri", "bharati")


@pytest.fixture(scope="module")
def detectors():
    dets = {}
    for sid in STATIONS:
        d = ae.AnomalyDetector(sid)
        d.load(str(app_config.anomaly_model_path(sid)))
        dets[sid] = d
    return dets


@pytest.fixture(scope="module")
def converged():
    """Converged predicted states for one cached window per station (no network)."""
    out = {}
    for sid in STATIONS:
        date = [d for s, d in ae.cached_windows((sid,))][-1]
        out[sid] = ev.converged_states(sid, date, seed=4242)
    return out


# ── 1. model files ────────────────────────────────────────────

def test_models_load_with_pinned_sklearn_without_warnings():
    import sklearn
    pin = re.search(r"^scikit-learn==([\d.]+)", (SIM_DIR / "requirements.txt").read_text(), re.M).group(1)
    assert sklearn.__version__ == pin
    for sid in STATIONS:
        with warnings.catch_warnings():
            warnings.simplefilter("error")          # InconsistentVersionWarning etc. → failure
            d = ae.AnomalyDetector(sid)
            d.load(str(app_config.anomaly_model_path(sid)))
        assert d.metadata["sklearn_version"] == pin
        assert d.metadata["seed"] == ae.SEED
        assert d.feature_names == ae.ALL_FEATURES


def test_stale_model_format_is_rejected(tmp_path):
    import pickle
    p = tmp_path / "old.pkl"
    p.write_bytes(pickle.dumps({"model": None, "feature_names": ["env_temp"]}))
    with pytest.raises(ValueError, match="retrain"):
        ae.AnomalyDetector("maitri").load(str(p))


# ── 2. converged normal state is not anomalous ────────────────

@pytest.mark.parametrize("sid", STATIONS)
def test_converged_normal_states_are_not_anomalous(detectors, converged, sid):
    det, states = detectors[sid], converged[sid]
    fe = ae.FeatureEngine(sid)
    X = np.array([ae.features_to_array(fe.extract(p, p)) for p in states[:300]])   # live-exact: observed == prediction
    assert not det.flags(X).any()
    r = det.score(fe.extract(states[300], states[300]))
    assert r["is_anomaly"] is False and r["evidence"] == [] and r["candidateCauses"] == []


def test_warmup_gate_requires_convergence():
    conv = ae.ConvergenceTracker("maitri")
    flags = []
    for _, _, _, meta, pm in ae.replay_states("maitri", ae.cached_windows(("maitri",))[-1][1], seed=1):
        flags.append(conv.update(pm, meta))
        if flags[-1]:
            break
    assert conv.converged_at is not None
    assert ae.WARMUP_MIN_TICKS <= conv.converged_at <= ae.WARMUP_MAX_TICKS
    assert not any(flags[:-1])                              # nothing recorded before convergence
    assert conv.run >= ae.CONVERGE_RUN_TICKS or conv.converged_at == ae.WARMUP_MAX_TICKS


# ── 3. every degradation / demo scenario is detected ──────────

@pytest.mark.parametrize("sid", STATIONS)
@pytest.mark.parametrize("name", list(ae.DEGRADATIONS))
def test_each_degradation_is_detected(detectors, converged, sid, name):
    res = ev.degradation_runs(detectors[sid], [converged[sid]], name, n_runs=10, rng=np.random.default_rng(7))
    assert res["detection_rate"] == 1.0, res


@pytest.mark.parametrize("sid", STATIONS)
@pytest.mark.parametrize("scenario", ev.DEMO_SCENARIOS)
def test_each_demo_scenario_is_detected(detectors, converged, sid, scenario):
    sc = ev.demo_scenarios()[scenario]
    res = ev.scenario_runs(detectors[sid], [converged[sid]], sc, n_runs=5, rng=np.random.default_rng(11))
    assert res["detection_rate"] == 1.0, res
    assert res["ttd_ticks_max"] <= res["duration_ticks"]


# ── 4. evidence compares against the physics prediction ───────

def test_evidence_expected_is_the_physics_prediction(detectors, converged):
    pred = converged["bharati"][500]
    obs = {b: dict(s) for b, s in pred.items()}
    obs["generator"]["gen_temp"] = pred["generator"]["gen_temp"] + 8.0       # +16σ
    fe = ae.FeatureEngine("bharati")
    for p in converged["bharati"][490:500]:
        fe.extract(p, p)
    r = detectors["bharati"].score(fe.extract(obs, pred))
    assert r["is_anomaly"] is True
    top = r["evidence"][0]
    assert top["sensor"] == "gen_temp"
    assert top["expected"] == pytest.approx(pred["generator"]["gen_temp"], abs=0.01)   # not a training mean (old 44 °C bug)
    assert top["value"] == pytest.approx(obs["generator"]["gen_temp"], abs=0.01)
    assert top["expectedSource"] == "physics model prediction (same tick)"
    assert r["candidateCauses"][0]["cause"] == "cooling_degradation"


# ── 5. train/serve skew ───────────────────────────────────────

def _simulator_ast():
    return ast.parse((SIM_DIR / "simulator.py").read_text())


def test_tick_dt_matches_simulator():
    assert ev.sim_tick_interval() == ae.PHYSICS_TICK_DT_S


def test_simulator_passes_physics_prediction():
    calls = [n for n in ast.walk(_simulator_ast())
             if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "extract_features"]
    assert calls, "simulator.py no longer calls extract_features"
    for c in calls:
        kw = {k.arg: k.value for k in c.keywords}
        assert "predicted" in kw and getattr(kw["predicted"], "id", None) == "physics_readings"


def test_training_and_live_features_identical():
    """Same state through the TRAINING path (observed_from_readings + FeatureEngine)
    and through the LIVE path (simulator-style values dict + extract_features)."""
    date = ae.cached_windows(("maitri",))[-1][1]
    ae._live_engines.pop("skewtest", None)
    train_fe = ae.FeatureEngine("skewtest")
    sim_values = {}
    n = 0
    for t, weather, readings, meta, pm in ae.replay_states("maitri", date, seed=99):
        # training path
        a = ae.features_to_array(train_fe.extract(ae.observed_from_readings(readings), readings))
        # live path — exactly what simulator._tick_reanalysis does
        for b, sensors in readings.items():
            for s, sd in sensors.items():
                sim_values.setdefault(b, {})[s] = sd["value"]
        f = ae.extract_features(weather, sim_values, meta, station_id="skewtest", predicted=readings)
        b_ = ae.features_to_array(f)
        np.testing.assert_array_equal(a, b_)
        n += 1
        if n >= 30:
            break


def test_live_and_training_weather_units_identical(monkeypatch):
    """get_current_weather (live) and sample_at (training) give identical weather,
    incl. env_wind in km/h — one code path for interpolation and units."""
    import weather_data
    date = ae.cached_windows(("bharati",))[-1][1]
    layer = weather_data.WeatherDataLayer("bharati", date=date, speed_factor=ae.TRAIN_SPEED)
    assert layer.fetch_and_cache()
    layer.start_time = 1_000_000.0
    for k in (0, 7, 123):
        elapsed_real = k * ae.PHYSICS_TICK_DT_S
        monkeypatch.setattr(weather_data.time, "time", lambda: 1_000_000.0 + elapsed_real)
        live = layer.get_current_weather()
        train = layer.sample_at(k * ae.PHYSICS_TICK_DT_S * ae.TRAIN_SPEED / 3600.0)
        assert live == train


def test_evaluate_never_writes_model_files():
    src = (SIM_DIR / "evaluate_anomaly.py").read_text()
    assert ".save(" not in src and "'wb'" not in src and '"wb"' not in src
