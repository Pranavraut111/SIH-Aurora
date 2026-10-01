"""B8 — analytics use the latest contiguous window (no stale / disjoint data),
honest provenance, and a TTL cache for fitted models."""

import pytest
from conftest import insert_obs

import analytics_ai_engine as ae

H = 3_600_000  # 1 hour in ms
ERA5 = "Antarctic-ERA5-Reanalysis"
NCPOR = "NCPOR-AWS-Live"


def _series(station, start_ts, n, dataset=ERA5, source="Open-Meteo ERA5 reanalysis", base=-10.0, step=H):
    return [(station, start_ts + i * step, "temperature", base + (i % 7) * 0.5, "°C", source, dataset)
            for i in range(n)]


@pytest.fixture
def two_windows(temp_db):
    """Old window (30 h) … 10-day gap … new window (40 h), same dataset."""
    old_start = 1_700_000_000_000
    new_start = old_start + 30 * H + 10 * 24 * H
    insert_obs(temp_db, _series("maitri", old_start, 30, base=-30.0))
    insert_obs(temp_db, _series("maitri", new_start, 40, base=-5.0))
    return {"old_start": old_start, "new_start": new_start, "new_end": new_start + 39 * H}


def test_latest_window_cuts_at_gap(two_windows):
    df, meta = ae.latest_window("maitri", "temperature", limit=500)
    assert meta["cutAtGap"] is True
    assert len(df) == 40
    assert int(df["timestamp"].iloc[0]) == two_windows["new_start"]
    assert int(df["timestamp"].iloc[-1]) == two_windows["new_end"]
    assert list(df["timestamp"]) == sorted(df["timestamp"])          # ascending
    assert meta["samplingIntervalMs"] == H


def test_limit_takes_newest_rows_not_oldest(two_windows):
    df, _ = ae.latest_window("maitri", "temperature", limit=10)
    assert int(df["timestamp"].iloc[-1]) == two_windows["new_end"]
    assert len(df) == 10


def test_newest_dataset_is_selected(temp_db):
    start = 1_700_000_000_000
    insert_obs(temp_db, _series("maitri", start, 30))                       # ERA5, older
    insert_obs(temp_db, _series("maitri", start + 40 * H, 20, dataset=NCPOR,
                                source="NCPOR Official Data Portal"))       # NCPOR, newer
    df, meta = ae.latest_window("maitri", "temperature")
    assert meta["dataset"] == NCPOR
    assert set(df["dataset"]) == {NCPOR}                                     # never mixed


def test_forecast_uses_latest_data_and_names_dataset(two_windows):
    res = ae.run_time_series_forecast("maitri", "temperature", "trend", horizon_steps=3)
    assert res["status"] == "success"
    assert res["historical"][-1]["timestamp"] == two_windows["new_end"]
    assert res["forecast"][0]["timestamp"] == two_windows["new_end"] + H
    assert ERA5 in res["provenance"]
    assert "NCPOR" not in res["provenance"]


def test_anomaly_uses_latest_window(two_windows):
    res = ae.run_anomaly_detection("maitri", "temperature", "isf")
    assert res["total_points"] == 40
    assert res["results"][0]["timestamp"] == two_windows["new_start"]
    assert ERA5 in res["provenance"]


def test_forecast_model_is_cached(two_windows, monkeypatch):
    calls = {"n": 0}
    real_fit = ae._fit_forecaster

    def counting_fit(series, model_type):
        calls["n"] += 1
        return real_fit(series, model_type)

    monkeypatch.setattr(ae, "_fit_forecaster", counting_fit)
    first = ae.run_time_series_forecast("maitri", "temperature", "trend", 6)
    second = ae.run_time_series_forecast("maitri", "temperature", "trend", 12)   # different horizon, same fit
    assert (first["modelCache"], second["modelCache"]) == ("miss", "hit")
    assert calls["n"] == 1
    assert len(second["forecast"]) == 12


def test_anomaly_result_is_cached_and_invalidated_by_new_data(two_windows, temp_db):
    a = ae.run_anomaly_detection("maitri", "temperature", "isf")
    b = ae.run_anomaly_detection("maitri", "temperature", "isf")
    assert (a["modelCache"], b["modelCache"]) == ("miss", "hit")
    insert_obs(temp_db, [("maitri", two_windows["new_end"] + H, "temperature", -4.0, "°C",
                          "Open-Meteo ERA5 reanalysis", ERA5)])
    c = ae.run_anomaly_detection("maitri", "temperature", "isf")
    assert c["modelCache"] == "miss"                                        # new data → refit
    assert c["total_points"] == 41


def test_cache_ttl_expires(monkeypatch):
    cache = ae._TTLCache(ttl_s=300)
    now = {"t": 1000.0}
    monkeypatch.setattr(ae.time, "monotonic", lambda: now["t"])
    cache.put("k", 1)
    now["t"] += 299
    assert cache.get("k") == 1
    now["t"] += 2
    assert cache.get("k") is None


def test_risk_provenance_names_datasets(two_windows):
    res = ae.assess_blizzard_and_polar_risks("maitri")
    assert ERA5 in res["provenance"]
    assert "NCPOR AWS telemetry" not in res["provenance"]
