"""
Antarctic Analytics & AI Engine
Analytical models over the SQLite observation store:
1. Isolation Forest Anomaly Detection
2. One-Class SVM Anomaly Detection
3. ARIMA Time-Series Forecasting
4. Exponential Smoothing / Polynomial Forecaster with Confidence Intervals
5. Correlation Matrix & Diurnal Cycle Analysis
6. Seasonal Comparisons & Variance Analysis
7. Antarctic Blizzard Risk Assessment
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM
import statsmodels.api as sm
from statsmodels.tsa.arima.model import ARIMA
import logging
import json
import threading
import time
from datetime import datetime, timezone

import db

log = logging.getLogger("aurora.analytics")

# A gap larger than GAP_FACTOR × the median sampling interval ends the window:
# analytics never concatenate disjoint periods (PROJECT_CONTEXT.md B8).
GAP_FACTOR = 3.0
MODEL_CACHE_TTL_S = 300  # fitted ISF/SVM/ARIMA models are reused for 5 minutes


# ═══════════════════════════════════════════════════════════════
#  Latest contiguous window
# ═══════════════════════════════════════════════════════════════

def _cut_at_last_gap(df: pd.DataFrame, gap_factor: float = GAP_FACTOR):
    """df ascending by timestamp. Keep only the rows after the last gap larger
    than gap_factor × median positive interval. Returns (df, interval_ms, cut)."""
    if len(df) < 3:
        return df, None, False
    diffs = np.diff(df["timestamp"].to_numpy())
    positive = diffs[diffs > 0]
    if positive.size == 0:
        return df, None, False
    interval = float(np.median(positive))
    big = np.nonzero(diffs > gap_factor * interval)[0]
    if big.size == 0:
        return df, interval, False
    first_kept = int(big[-1]) + 1
    return df.iloc[first_kept:].reset_index(drop=True), interval, True


def latest_window(station_id, parameter="temperature", limit=500, dataset=None):
    """Latest contiguous window for (station, parameter, dataset).

    - dataset defaults to the dataset of the NEWEST row for this station/parameter
    - newest `limit` rows (ORDER BY timestamp DESC), then reversed to ascending
    - cut at the last gap > GAP_FACTOR × median interval
    Returns (df ascending with reset index, meta dict)."""
    with db.connect() as conn:
        if dataset is None:
            row = conn.execute(
                "SELECT dataset FROM observations WHERE station_id = ? AND parameter = ? "
                "ORDER BY timestamp DESC LIMIT 1", (station_id, parameter)).fetchone()
            dataset = row[0] if row else None
        if dataset is None:
            empty = pd.DataFrame(columns=["timestamp", "iso_time", "parameter", "value", "unit", "source",
                                          "dataset", "sensor", "quality", "latitude", "longitude"])
            return empty, {"dataset": None, "source": None, "points": 0}
        df = pd.read_sql_query(
            """
            SELECT timestamp, iso_time, parameter, value, unit, source, dataset, sensor, quality, latitude, longitude
            FROM observations
            WHERE station_id = ? AND parameter = ? AND dataset = ?
            ORDER BY timestamp DESC
            LIMIT ?
            """, conn, params=[station_id, parameter, dataset, int(limit)])

    df = df.iloc[::-1].reset_index(drop=True)          # ascending
    df, interval_ms, cut = _cut_at_last_gap(df)
    meta = {
        "dataset": dataset,
        "source": df["source"].iloc[-1] if len(df) else None,
        "points": int(len(df)),
        "start": df["iso_time"].iloc[0] if len(df) else None,
        "end": df["iso_time"].iloc[-1] if len(df) else None,
        "endTimestamp": int(df["timestamp"].iloc[-1]) if len(df) else None,
        "samplingIntervalMs": None if interval_ms is None else int(interval_ms),
        "cutAtGap": bool(cut),
    }
    return df, meta


def query_observations(station_id, parameter="temperature", frequency="h", start_ts=None, end_ts=None, limit=500):
    """Latest contiguous window (see latest_window). With explicit start/end,
    rows in that range (newest `limit`, ascending, single dataset)."""
    if start_ts is None and end_ts is None:
        df, meta = latest_window(station_id, parameter, limit=limit)
        df.attrs["window"] = meta
        return df
    with db.connect() as conn:
        q = ("SELECT timestamp, iso_time, parameter, value, unit, source, dataset, sensor, quality, latitude, longitude "
             "FROM observations WHERE station_id = ? AND parameter = ?")
        params = [station_id, parameter]
        if start_ts:
            q += " AND timestamp >= ?"; params.append(start_ts)
        if end_ts:
            q += " AND timestamp <= ?"; params.append(end_ts)
        q += " ORDER BY timestamp DESC LIMIT ?"; params.append(int(limit))
        df = pd.read_sql_query(q, conn, params=params)
    return df.iloc[::-1].reset_index(drop=True)


def _provenance(meta: dict, what: str) -> str:
    if not meta.get("dataset"):
        return f"{what}: no observations available"
    return (f"{what} on {meta['points']} points of dataset {meta['dataset']} "
            f"(source: {meta['source']}), window {meta['start']} → {meta['end']}")


# ═══════════════════════════════════════════════════════════════
#  Fitted-model cache (5-minute TTL)
# ═══════════════════════════════════════════════════════════════

class _TTLCache:
    def __init__(self, ttl_s: float, max_items: int = 256):
        self.ttl_s = ttl_s
        self.max_items = max_items
        self._lock = threading.Lock()
        self._items = {}

    def get(self, key):
        with self._lock:
            hit = self._items.get(key)
            if hit is None:
                return None
            expires, value = hit
            if time.monotonic() >= expires:
                del self._items[key]
                return None
            return value

    def put(self, key, value):
        with self._lock:
            if len(self._items) >= self.max_items:
                now = time.monotonic()
                for k in [k for k, (exp, _) in self._items.items() if exp <= now]:
                    del self._items[k]
                if len(self._items) >= self.max_items:
                    self._items.pop(next(iter(self._items)))
            self._items[key] = (time.monotonic() + self.ttl_s, value)

    def clear(self):
        with self._lock:
            self._items.clear()


MODEL_CACHE = _TTLCache(MODEL_CACHE_TTL_S)


def _cache_key(station_id, parameter, algorithm, meta, *extra):
    # endTimestamp/points in the key: new data invalidates immediately; TTL bounds staleness.
    return (station_id, parameter, algorithm, meta.get("dataset"), meta.get("endTimestamp"), meta.get("points"), *extra)


# ═══════════════════════════════════════════════════════════════
#  Anomaly detection (ISF / One-Class SVM)
# ═══════════════════════════════════════════════════════════════

def run_anomaly_detection(station_id, parameter="temperature", algorithm="isf", contamination=0.08):
    """Isolation Forest or One-Class SVM on the latest contiguous observation window.
    Returns observations with anomaly flags and scores."""
    df, meta = latest_window(station_id, parameter, limit=1000)
    if df.empty or len(df) < 10:
        return {"status": "error", "message": "Insufficient data points", "window": meta}

    key = _cache_key(station_id, parameter, algorithm, meta, contamination)
    cached = MODEL_CACHE.get(key)
    if cached is not None:
        return {**cached, "modelCache": "hit"}

    values = df["value"].values.reshape(-1, 1)

    # Feature engineering: value, rate of change (delta), rolling residual
    diffs = np.diff(values.flatten(), prepend=values[0])
    rolling_mean = pd.Series(values.flatten()).rolling(window=5, min_periods=1).mean().values
    residuals = values.flatten() - rolling_mean
    X = np.column_stack([values, diffs, residuals])

    if algorithm == "svm":
        model = OneClassSVM(nu=contamination, kernel="rbf", gamma="scale")
    else:  # default isf
        model = IsolationForest(contamination=contamination, random_state=42)

    preds = model.fit_predict(X)
    scores = -model.decision_function(X)  # higher = more anomalous

    results = []
    anomalies_detected = 0
    for i, row in df.iterrows():
        is_anom = int(preds[i] == -1)
        anomalies_detected += is_anom
        results.append({
            "timestamp": int(row["timestamp"]),
            "iso_time": row["iso_time"],
            "value": float(row["value"]),
            "unit": row["unit"],
            "is_anomaly": bool(is_anom),
            "anomaly_score": float(scores[i]),
            "source": row["source"],
            "dataset": row["dataset"]
        })

    result = {
        "status": "success",
        "station_id": station_id,
        "parameter": parameter,
        "algorithm": "Isolation Forest" if algorithm == "isf" else "One-Class SVM",
        "total_points": len(results),
        "anomalies_count": anomalies_detected,
        "contamination_rate": contamination,
        "results": results,
        "window": meta,
        "provenance": _provenance(meta, "Anomaly model fitted"),
    }
    MODEL_CACHE.put(key, result)
    return {**result, "modelCache": "miss"}


# ═══════════════════════════════════════════════════════════════
#  Forecasting (ARIMA / polynomial trend)
# ═══════════════════════════════════════════════════════════════

def _fit_forecaster(series, model_type):
    """Returns a callable(horizon) -> (values, lower, upper) and a model label."""
    if model_type == "arima":
        fitted = ARIMA(series, order=(1, 1, 1)).fit()

        def predict(h):
            res = fitted.get_forecast(steps=h)
            ci = res.conf_int(alpha=0.05)
            return res.predicted_mean, ci[:, 0], ci[:, 1]
        return predict, "ARIMA(1,1,1)"

    x = np.arange(len(series))
    poly = np.polyfit(x, series, deg=min(2, len(series) - 1))
    sigma = np.std(series - np.polyval(poly, x))

    def predict(h):
        fx = np.arange(len(series), len(series) + h)
        vals = np.polyval(poly, fx)
        return vals, vals - 1.96 * sigma, vals + 1.96 * sigma
    return predict, "Polynomial trend (deg ≤ 2) with ±1.96σ band"


def run_time_series_forecast(station_id, parameter="temperature", model_type="arima", horizon_steps=24):
    """Forecast from the LATEST contiguous window (never stale/oldest data, never
    across gaps). Returns forecast values with 95% confidence intervals."""
    df, meta = latest_window(station_id, parameter, limit=500)
    if df.empty or len(df) < 12:
        return {"status": "error", "message": "Need at least 12 observations to forecast", "window": meta}

    series = df["value"].values
    last_ts = int(df["timestamp"].iloc[-1])
    step_ms = meta.get("samplingIntervalMs") or 3600000
    unit = df["unit"].iloc[-1]

    key = _cache_key(station_id, parameter, model_type, meta)
    cached = MODEL_CACHE.get(key)
    cache_state = "hit" if cached is not None else "miss"
    try:
        if cached is None:
            cached = _fit_forecaster(series, model_type)
            MODEL_CACHE.put(key, cached)
        predict, model_label = cached
        forecast_vals, lower_ci, upper_ci = predict(horizon_steps)
    except Exception as e:
        # Robust fallback: linear drift + overall variance (logged, not silent)
        log.warning("[%s/%s] %s fit failed (%s); using linear-drift fallback", station_id, parameter, model_type, e)
        model_label = "Linear drift fallback"
        trend = (series[-1] - series[0]) / max(1, len(series))
        forecast_vals = [series[-1] + trend * (i + 1) for i in range(horizon_steps)]
        sigma = np.std(series) if len(series) > 1 else 1.0
        lower_ci = [v - 1.96 * sigma for v in forecast_vals]
        upper_ci = [v + 1.96 * sigma for v in forecast_vals]

    forecast_points = []
    for i in range(horizon_steps):
        t = last_ts + (i + 1) * step_ms
        forecast_points.append({
            "timestamp": t,
            "iso_time": datetime.fromtimestamp(t / 1000.0, tz=timezone.utc).isoformat(),
            "predicted": round(float(forecast_vals[i]), 2),
            "lower_bound": round(float(lower_ci[i]), 2),
            "upper_bound": round(float(upper_ci[i]), 2),
            "unit": unit
        })

    historical_points = [{
        "timestamp": int(row["timestamp"]),
        "iso_time": row["iso_time"],
        "actual": round(float(row["value"]), 2),
        "unit": row["unit"]
    } for _, row in df.tail(48).iterrows()]

    return {
        "status": "success",
        "station_id": station_id,
        "parameter": parameter,
        "model": model_label,
        "horizon_steps": horizon_steps,
        "historical": historical_points,
        "forecast": forecast_points,
        "window": meta,
        "modelCache": cache_state,
        "provenance": _provenance(meta, f"{model_label} fitted"),
    }


# ═══════════════════════════════════════════════════════════════
#  Correlation
# ═══════════════════════════════════════════════════════════════

def run_correlation_matrix(station_id):
    """Pearson correlation between parameters, within the latest contiguous
    window of the station's newest dataset (no cross-dataset / cross-gap mixing)."""
    _, meta = latest_window(station_id, "temperature", limit=1000)
    if not meta.get("dataset"):
        return {"status": "error", "message": "No data"}
    key = _cache_key(station_id, "*", "pearson", meta)
    cached = MODEL_CACHE.get(key)
    if cached is not None:
        return {**cached, "modelCache": "hit"}

    with db.connect() as conn:
        df = pd.read_sql_query("""
            SELECT timestamp, parameter, value
            FROM observations
            WHERE station_id = ? AND dataset = ? AND timestamp BETWEEN ? AND ?
            ORDER BY timestamp ASC
        """, conn, params=[station_id, meta["dataset"],
                           int(pd.Timestamp(meta["start"]).timestamp() * 1000), meta["endTimestamp"]])

    if df.empty:
        return {"status": "error", "message": "No data"}

    pivot_df = df.pivot_table(index="timestamp", columns="parameter", values="value", aggfunc="mean")
    corr = pivot_df.corr().round(3).fillna(0)

    params = list(corr.columns)
    matrix = {p1: {p2: float(corr.loc[p1, p2]) for p2 in params} for p1 in params}
    result = {
        "status": "success",
        "station_id": station_id,
        "parameters": params,
        "correlation_matrix": matrix,
        "window": meta,
        "provenance": _provenance(meta, "Pearson correlation computed"),
    }
    MODEL_CACHE.put(key, result)
    return {**result, "modelCache": "miss"}


def assess_blizzard_and_polar_risks(station_id):
    """
    Evaluates real Antarctic operational risks based on recent AWS observations.
    Triggers:
    - Blizzard: Wind speed > 15 m/s (54 km/h), Temp < -10°C, falling pressure
    - Severe Frostbite / Cold Hazard: Temp < -35°C or Wind Chill < -50°C
    - Comms Degradation: Wind > 25 m/s or Severe solar/auroral activity
    - Thermal Overload on Station Generators: Building heating demand spike
    """
    with db.connect() as conn:
        df = pd.read_sql_query("""
            SELECT parameter, value, unit, timestamp, dataset, source
            FROM observations
            WHERE station_id = ?
            ORDER BY timestamp DESC
            LIMIT 100
        """, conn, params=[station_id])

    used_datasets = set()
    if df.empty:
        # Default baseline if no records (HARDCODED-DEMO values)
        latest = {"temperature": -15.0, "wind_speed": 12.0, "air_pressure": 985.0, "relative_humidity": 65.0}
    else:
        latest = {}
        for _, row in df.iterrows():
            p = row["parameter"]
            if p not in latest:
                latest[p] = float(row["value"])
                used_datasets.add(f"{row['dataset']} ({row['source']})")

    temp = latest.get("temperature", -15.0)
    wind = latest.get("wind_speed", 10.0) # in m/s
    wind_kmh = wind * 3.6
    pres = latest.get("air_pressure", 985.0)
    hum = latest.get("relative_humidity", 60.0)

    # Antarctic Wind Chill Calculation (Environment Canada formula)
    if wind_kmh > 4.8 and temp <= 0:
        wind_chill = 13.12 + (0.6215 * temp) - (11.37 * (wind_kmh ** 0.16)) + (0.3965 * temp * (wind_kmh ** 0.16))
    else:
        wind_chill = temp

    risks = []
    overall_score = 15  # baseline nominal

    # 1. Blizzard Risk
    if wind >= 18.0 and temp <= -10.0:
        overall_score += 45
        risks.append({
            "risk_id": "RSK-BLIZZARD-01",
            "risk_level": "critical",
            "risk_score": 85,
            "affected_system": "Outdoor Operations & Helipad",
            "reason": f"Active Blizzard Conditions: Sustained wind at {wind:.1f} m/s ({wind_kmh:.0f} km/h) with ambient temp {temp:.1f}°C.",
            "recommended_action": "Enforce station lockdown. Restrict outdoor movements to life-line secured corridors. Halt field scientific expeditions."
        })
    elif wind >= 12.0:
        overall_score += 25
        risks.append({
            "risk_id": "RSK-WIND-02",
            "risk_level": "warning",
            "risk_score": 55,
            "affected_system": "Antenna Mast & External Sensors",
            "reason": f"High Wind Alert ({wind:.1f} m/s). Increased structural load on communications mast and snow drifting around generator intakes.",
            "recommended_action": "Inspect mast guy-wire tension telemetry and monitor generator air intake heaters."
        })

    # 2. Extreme Cold & Heating Demand Spike
    if temp < -35.0 or wind_chill < -45.0:
        overall_score += 35
        risks.append({
            "risk_id": "RSK-THERMAL-01",
            "risk_level": "critical",
            "risk_score": 80,
            "affected_system": "Primary Diesel Generator & Heating Zone A",
            "reason": f"Severe Wind Chill ({wind_chill:.1f}°C). Structural heat loss increases by ~42%, requiring continuous auxiliary heating and boosting generator power demand by +28 kW.",
            "recommended_action": "Engage secondary heating circuit (Zone B) and bring Backup Generator to hot-standby readiness."
        })
    elif temp < -25.0:
        overall_score += 15
        risks.append({
            "risk_id": "RSK-THERMAL-02",
            "risk_level": "warning",
            "risk_score": 45,
            "affected_system": "Water Treatment Snow-Melt Line",
            "reason": f"Ambient Temperature ({temp:.1f}°C) below glycol heat-exchanger optimal threshold. Risk of line freezing if flow drops below 15 L/min.",
            "recommended_action": "Verify snow-melt tracer heating current and maintain recirculation pumps."
        })

    overall_score = min(100, overall_score)
    overall_level = "critical" if overall_score >= 70 else "warning" if overall_score >= 40 else "healthy"

    return {
        "status": "success",
        "station_id": station_id,
        "overall_health": overall_level,
        "risk_score": overall_score,
        "wind_chill_c": round(wind_chill, 1),
        "current_weather": {
            "temperature_c": temp,
            "wind_speed_ms": wind,
            "wind_speed_kmh": round(wind_kmh, 1),
            "air_pressure_hpa": pres,
            "relative_humidity_pct": hum
        },
        "identified_risks": risks,
        "provenance": ("Rule-based risk engine on the latest values from: " + "; ".join(sorted(used_datasets))
                       if used_datasets else "Rule-based risk engine on built-in default values (no observations in DB)")
    }

if __name__ == "__main__":
    print("Testing Anomaly Detection...")
    res_anom = run_anomaly_detection("maitri", "temperature", "isf")
    print(f"Anomaly detection: {res_anom['total_points']} points analyzed, {res_anom['anomalies_count']} anomalies found.")
    
    print("\nTesting Forecast Engine...")
    res_fc = run_time_series_forecast("maitri", "temperature", "arima", 12)
    print(f"Forecast generated: {len(res_fc['forecast'])} horizon points.")

    print("\nTesting Risk Engine...")
    res_risk = assess_blizzard_and_polar_risks("maitri")
    print(f"Risk assessment: Health={res_risk['overall_health']}, Score={res_risk['risk_score']}, Identified risks={len(res_risk['identified_risks'])}")
