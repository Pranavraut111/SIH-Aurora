"""
NCPOR & NPDC Antarctic Data Ingestor
Connects to official National Centre for Polar and Ocean Research (NCPOR) portals & scientific archives:
- Live Automatic Weather Station (AWS) data for Maitri and Bharati
- Historical observation datasets across all polar seasons (Summer, Fall, Winter, Spring)
- Normalizes all observations into the unified Antarctic Observation Schema:
  station_id, station_name, timestamp, parameter, value, unit, source, dataset, sensor, quality, latitude, longitude
"""

import json
import logging
import re
import sqlite3
import time
from datetime import datetime, timezone

import requests

import db
import station_config
from config import WEATHER_CACHE_DIR
from units import cache_wind_unit, wind_factor_to_ms

log = logging.getLogger("aurora.ingest")

# Honest provenance for ERA5 rows imported from the Open-Meteo cache.
# (Earlier imports were mislabelled "NCPOR / ECMWF …", "IMD/ERA5 …" and stored
#  km/h wind as m/s — fixed for existing rows by migrations/001_fix_era5_wind_units.py.)
ERA5_SOURCE = "Open-Meteo ERA5 reanalysis"
ERA5_DATASET = "Antarctic-ERA5-Reanalysis"
ERA5_QUALITY = "reanalysis"
ERA5_SENSORS = {
    "temperature": "ERA5 2 m air temperature",
    "wind_speed": "ERA5 10 m wind speed",
    "air_pressure": "ERA5 surface pressure",
    "relative_humidity": "ERA5 2 m relative humidity",
    "wind_direction": "ERA5 10 m wind direction",
}

# Derived from station_config.json (single source of truth) — do not hardcode here.
STATION_INFO = {
    sid: {
        "id": sid,
        "name": station_config.meta_value(sid, "fullName"),
        "latitude": station_config.meta_value(sid, "latitude"),
        "longitude": station_config.meta_value(sid, "longitude"),
        "elevation_m": station_config.meta_value(sid, "elevation_m"),
        "region": station_config.meta_value(sid, "region"),
        "live_url": station_config.meta_value(sid, "ncporLiveUrl"),
        "sources": station_config.meta_value(sid, "ncporSources"),
    }
    for sid in station_config.station_ids()
}

def init_db():
    """Create the schema, seed inventory, run migrations (idempotent)."""
    db.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db.connect() as conn:
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                station_id TEXT NOT NULL,
                station_name TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                iso_time TEXT NOT NULL,
                parameter TEXT NOT NULL,
                value REAL NOT NULL,
                unit TEXT NOT NULL,
                source TEXT NOT NULL,
                dataset TEXT NOT NULL,
                sensor TEXT,
                quality TEXT NOT NULL DEFAULT 'verified',
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(station_id, timestamp, parameter, dataset)
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_obs_station_time ON observations(station_id, timestamp)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_obs_param ON observations(parameter)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_obs_source ON observations(source)")

        # Ingestion logs
        c.execute("""
            CREATE TABLE IF NOT EXISTS ingestion_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                station_id TEXT NOT NULL,
                source_url TEXT NOT NULL,
                status TEXT NOT NULL,
                records_ingested INTEGER NOT NULL,
                message TEXT,
                timestamp INTEGER NOT NULL
            )
        """)

        # Operational/User Entered Logistics & Inventory table
        c.execute("""
            CREATE TABLE IF NOT EXISTS logistics_inventory (
                id TEXT PRIMARY KEY,
                station_id TEXT NOT NULL,
                category TEXT NOT NULL,
                name TEXT NOT NULL,
                current REAL NOT NULL,
                max_capacity REAL NOT NULL,
                unit TEXT NOT NULL,
                daily_consumption REAL NOT NULL,
                reorder_threshold REAL NOT NULL,
                last_updated INTEGER NOT NULL,
                updated_by TEXT NOT NULL,
                provenance TEXT NOT NULL DEFAULT 'User-Entered Operational'
            )
        """)

        # Remote Commands Queue
        c.execute("""
            CREATE TABLE IF NOT EXISTS remote_commands (
                id TEXT PRIMARY KEY,
                station_id TEXT NOT NULL,
                subsystem TEXT NOT NULL,
                command TEXT NOT NULL,
                parameters TEXT,
                status TEXT NOT NULL, -- pending, dispatched, executed, failed
                created_at INTEGER NOT NULL,
                dispatched_at INTEGER,
                executed_at INTEGER,
                issued_by TEXT NOT NULL,
                response_log TEXT
            )
        """)

        # Alerts & Incidents Table
        c.execute("""
            CREATE TABLE IF NOT EXISTS station_alerts (
                id TEXT PRIMARY KEY,
                station_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                severity TEXT NOT NULL, -- info, warning, critical
                subsystem TEXT NOT NULL,
                parameter TEXT,
                observed_value REAL,
                threshold_or_model TEXT,
                reason TEXT NOT NULL,
                recommended_action TEXT,
                status TEXT NOT NULL, -- active, acknowledged, resolved
                acknowledged_by TEXT,
                acknowledged_at INTEGER,
                resolved_at INTEGER
            )
        """)

        # Seed initial inventory if empty
        c.execute("SELECT COUNT(*) FROM logistics_inventory")
        if c.fetchone()[0] == 0:
            now_ts = int(time.time() * 1000)
            seed_items = [
                ("maitri-fuel", "maitri", "Energy", "Polar Diesel (A-1 Grade)",
                 68400, 100000, "L", 280, 25000, now_ts, "Station Commander"),
                ("maitri-food", "maitri", "Life Support", "Preserved Rations & Provisions",
                 14200, 20000, "rations", 75, 4000, now_ts, "Logistics Officer"),
                ("maitri-med", "maitri", "Medical", "Emergency Medical Packs",
                 380, 500, "kits", 1.2, 100, now_ts, "Chief Medical Officer"),
                ("maitri-spares", "maitri", "Maintenance", "Generator Spare Kits & Filters",
                 92, 150, "units", 0.4, 30, now_ts, "Lead Engineer"),
                ("maitri-water", "maitri", "Water", "Potable Snow-Melt Reserves",
                 45000, 60000, "L", 850, 15000, now_ts, "Environmental Officer"),

                ("bharati-fuel", "bharati", "Energy", "Polar Diesel (A-1 Grade)",
                 112000, 150000, "L", 340, 35000, now_ts, "Station Commander"),
                ("bharati-food", "bharati", "Life Support", "Preserved Rations & Provisions",
                 24500, 35000, "rations", 140, 6000, now_ts, "Logistics Officer"),
                ("bharati-med", "bharati", "Medical", "Emergency Medical Packs",
                 620, 800, "kits", 2.0, 150, now_ts, "Chief Medical Officer"),
                ("bharati-spares", "bharati", "Maintenance", "Generator Spare Kits & Filters",
                 160, 250, "units", 0.6, 50, now_ts, "Lead Engineer"),
                ("bharati-water", "bharati", "Water", "Potable Snow-Melt Reserves",
                 72000, 90000, "L", 1200, 20000, now_ts, "Environmental Officer"),
            ]
            c.executemany("""
                INSERT INTO logistics_inventory
                (id, station_id, category, name, current, max_capacity, unit,
                 daily_consumption, reorder_threshold, last_updated, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, seed_items)

        conn.commit()

        # Apply pending schema/data migrations (idempotent; each records itself).
        from migrations import run_migrations
        run_migrations(conn)


def parse_canvasjs_series(html_text):
    """{series name: [(epoch ms, value), …]} from the CanvasJS charts on an NCPOR live page."""
    results = {}
    pattern = r'name:\s*"([^"]+)"[\s\S]*?dataPoints:\s*\[([\s\S]*?)\]'
    matches = re.findall(pattern, html_text)
    for name, points_block in matches:
        series_name = name.strip()
        point_pattern = r'x:\s*(\d+),\s*y\s*:\s*([-\d.]+)'
        points = re.findall(point_pattern, points_block)
        parsed_points = []
        for x_str, y_str in points:
            try:
                parsed_points.append((int(x_str), float(y_str)))
            except ValueError:
                log.debug("NCPOR series %r: skipped unparsable point (%r, %r)", series_name, x_str, y_str)
                continue
        if parsed_points:
            results[series_name] = parsed_points
    return results


# Series on the NCPOR live page → (parameter, unit, sensor). The wind unit is taken from
# the page's own axis title ("Wind Speed (m/s)"); NCPOR does not document it elsewhere,
# so it is reported as "as labelled on the page, not independently confirmed".
NCPOR_SERIES = {
    "temperature": ("temperature", "°C", "IMD AWS Temp Sensor"),
    "wind speed": ("wind_speed", "m/s", "Anemometer (10m)"),
    "air pressure": ("air_pressure", "hPa", "Barometric Pressure Sensor"),
    "relative humidity": ("relative_humidity", "%", "Hygrometer (2m)"),
    "wind direction": ("wind_direction", "°", "Wind Vane (10m)"),
}
NCPOR_DATASET = "NCPOR-AWS-Live"
NCPOR_SOURCE = "NCPOR Official Data Portal"

# Plausibility (a value outside → "suspect"): physical limits for a coastal/near-coastal
# Antarctic AWS, and the largest believable change per hour between two readings.
PLAUSIBLE_RANGE = {
    "temperature": (-90.0, 25.0), "wind_speed": (0.0, 60.0), "air_pressure": (850.0, 1080.0),
    "relative_humidity": (0.0, 100.0), "wind_direction": (0.0, 360.0),
}
MAX_CHANGE_PER_HOUR = {"temperature": 12.0, "wind_speed": 20.0, "air_pressure": 8.0, "relative_humidity": 50.0}
SUSPECT = "suspect"
GOOD = "verified_aws_telemetry"


class NcporPageError(Exception):
    """The page answered but could not be used (format changed, no known series)."""


def page_wind_unit(html_text: str) -> str | None:
    """The unit in the page's wind-speed axis title, e.g. 'm/s', or None if absent."""
    m = re.search(r'title:\s*"Wind Speed\s*\(([^)]+)\)"', html_text, re.IGNORECASE)
    return m.group(1).strip() if m else None


def check_plausibility(param: str, points: list[tuple[int, float]]) -> list[tuple[int, float, str | None]]:
    """[(ts, value, reason or None)], oldest first. A value is suspect if it is outside the
    physical range, or changed faster than MAX_CHANGE_PER_HOUR since the last good value
    (so one spike is flagged, not the reading after it)."""
    lo, hi = PLAUSIBLE_RANGE.get(param, (float("-inf"), float("inf")))
    rate = MAX_CHANGE_PER_HOUR.get(param)
    out, last_good = [], None
    for ts, v in sorted(points):
        reason = None
        if not (lo <= v <= hi):
            reason = f"outside the plausible range {lo:g}…{hi:g}"
        elif rate is not None and last_good is not None:
            hours = max(1.0, (ts - last_good[0]) / 3_600_000)
            if abs(v - last_good[1]) > rate * hours:
                reason = f"jumped {abs(v - last_good[1]):.1f} in {hours:.1f} h (limit {rate:g}/h)"
        if reason is None:
            last_good = (ts, v)
        out.append((ts, v, reason))
    return out


def fetch_live_page(url: str) -> str:
    headers = {"User-Agent": "AntarcticDigitalTwin/1.0 (NCPOR Scientific Integration)"}
    resp = requests.get(url, headers=headers, timeout=12)
    if resp.status_code != 200:
        raise NcporPageError(f"HTTP {resp.status_code}")
    return resp.text


def ingest_live_station(station_id: str):
    """Fetch, parse, check and store one station's NCPOR live page. Never raises: the
    result says success/failed, and every attempt is logged in ingestion_logs. A failed
    attempt stores nothing, so the last good data stays in place."""
    info = STATION_INFO.get(station_id.lower())
    if not info:
        return {"status": "error", "message": f"Unknown station {station_id}"}

    url = info["live_url"]
    try:
        html = fetch_live_page(url)
        series_map = parse_canvasjs_series(html)
        known = {}
        unknown = []
        for series_name, points in series_map.items():
            meta = next((m for k, m in NCPOR_SERIES.items() if k in series_name.lower()), None)
            if meta is None:
                unknown.append(series_name)
            else:
                known[series_name] = (meta, points)
        if not known:
            raise NcporPageError("page format changed: no known data series found"
                                 + (f" (found: {', '.join(unknown)})" if unknown else ""))
        if unknown:
            log.warning("[%s] NCPOR page has unknown series %s (ignored)", station_id, unknown)
        wind_unit = page_wind_unit(html)
        if any(m[0] == "wind_speed" for m, _ in known.values()) and wind_unit not in ("m/s", None):
            raise NcporPageError(f"wind speed is now labelled '{wind_unit}' on the page (expected m/s)")

        now_ts = int(time.time() * 1000)
        ingested = suspect = 0
        suspects = []
        newest = None
        with db.connect() as conn:
            for (param, unit, sensor), points in known.values():
                for pt_ts, val, reason in check_plausibility(param, points):
                    quality = SUSPECT if reason else GOOD
                    conn.execute("""
                        INSERT OR REPLACE INTO observations
                        (station_id, station_name, timestamp, iso_time, parameter, value, unit,
                         source, dataset, sensor, quality, latitude, longitude, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (info["id"], info["name"], pt_ts,
                          datetime.fromtimestamp(pt_ts / 1000.0, tz=timezone.utc).isoformat(),
                          param, val, unit, NCPOR_SOURCE, NCPOR_DATASET, sensor, quality,
                          info["latitude"], info["longitude"], now_ts))
                    ingested += 1
                    newest = pt_ts if newest is None else max(newest, pt_ts)
                    if reason:
                        suspect += 1
                        suspects.append({"parameter": param, "timestamp": pt_ts, "value": val, "reason": reason})
            message = f"Ingested {ingested} observations from NCPOR AWS"
            if suspect:
                message += f"; {suspect} flagged suspect"
                log.warning("[%s] NCPOR: %d suspect value(s): %s", station_id, suspect, suspects[:5])
            conn.execute("""
                INSERT INTO ingestion_logs (station_id, source_url, status, records_ingested, message, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (station_id, url, "success", ingested, message, now_ts))

        return {
            "status": "success",
            "station_id": station_id,
            "records_ingested": ingested,
            "suspect": suspect,
            "suspectValues": suspects[:20],
            "newestObservation": newest,
            "windUnitOnPage": wind_unit,
            "parameters": [n for n in known],
            "source": "https://data.ncpor.res.in",
        }
    except (requests.RequestException, NcporPageError, sqlite3.Error) as e:
        log.warning("[%s] NCPOR live ingest failed: %s", station_id, e)
        message = f"NCPOR page unreachable: {e}" if isinstance(e, requests.RequestException) else str(e)
        with db.connect() as conn:
            conn.execute("""
                INSERT INTO ingestion_logs (station_id, source_url, status, records_ingested, message, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (station_id, url, "failed", 0, message, int(time.time() * 1000)))
        return {"status": "failed", "error": message, "station_id": station_id}

def ingest_cached_historical_data():
    """
    Ingests all existing cached Antarctic datasets (ERA5 reanalysis & seasonal observation files)
    into the unified database with full metadata and provenance.
    """
    cache_dir = WEATHER_CACHE_DIR
    if not cache_dir.exists():
        return 0

    total_ingested = 0
    now_ts = int(time.time() * 1000)
    with db.connect() as conn:
        c = conn.cursor()

        for json_file in cache_dir.glob("*.json"):
            if "forecast" in json_file.name:
                continue

            try:
                with open(json_file) as f:
                    data = json.load(f)

                # Determine station
                st_id = "maitri" if "maitri" in json_file.name.lower() else "bharati"
                info = STATION_INFO[st_id]

                hourly = data.get("hourly", {})
                # Units live in `hourly_units` (not in `hourly`). Missing → Open-Meteo default km/h.
                wind_to_ms = wind_factor_to_ms(cache_wind_unit(data))
                times = hourly.get("time", [])
                temps = hourly.get("temperature_2m", [])
                winds = hourly.get("wind_speed_10m", [])
                pressures = hourly.get("surface_pressure", [])
                humidities = hourly.get("relative_humidity_2m", [])
                wind_dirs = hourly.get("wind_direction_10m", [])

                for i in range(len(times)):
                    t_str = times[i]
                    dt = datetime.fromisoformat(t_str).replace(tzinfo=timezone.utc)
                    ts = int(dt.timestamp() * 1000)
                    iso = dt.isoformat()

                    records = [
                        (temps, "temperature", "°C"),
                        (winds, "wind_speed", "m/s"),        # stored in m/s (converted below)
                        (pressures, "air_pressure", "hPa"),
                        (humidities, "relative_humidity", "%"),
                        (wind_dirs, "wind_direction", "°"),
                    ]

                    for arr, param, unit in records:
                        sensor = ERA5_SENSORS[param]
                        if i < len(arr) and arr[i] is not None:
                            val = float(arr[i])
                            if param == "wind_speed":
                                val = round(val * wind_to_ms, 2)
                            c.execute("""
                                INSERT OR IGNORE INTO observations
                                (station_id, station_name, timestamp, iso_time, parameter, value, unit,
                             source, dataset, sensor, quality, latitude, longitude, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (
                                info["id"],
                                info["name"],
                                ts,
                                iso,
                                param,
                                val,
                                unit,
                                ERA5_SOURCE,
                                ERA5_DATASET,
                                sensor,
                                ERA5_QUALITY,
                                info["latitude"],
                                info["longitude"],
                                now_ts
                            ))
                            total_ingested += 1

            except Exception as e:
                log.warning("Error reading %s: %s", json_file.name, e)

    return total_ingested

if __name__ == "__main__":
    init_db()
    total = ingest_cached_historical_data()
    print(f"Ingested {total} historical records into SQLite database.")
    r1 = ingest_live_station("maitri")
    r2 = ingest_live_station("bharati")
    print("Maitri live:", r1)
    print("Bharati live:", r2)
