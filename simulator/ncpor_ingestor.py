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

def ingest_live_station(station_id: str):
    info = STATION_INFO.get(station_id.lower())
    if not info:
        return {"status": "error", "message": f"Unknown station {station_id}"}

    url = info["live_url"]
    headers = {"User-Agent": "AntarcticDigitalTwin/1.0 (NCPOR Scientific Integration)"}
    try:
        resp = requests.get(url, headers=headers, timeout=12)
        if resp.status_code != 200:
            raise Exception(f"HTTP {resp.status_code}")

        series_map = parse_canvasjs_series(resp.text)
        if not series_map:
            raise Exception("No data series parsed from page")

        now_ts = int(time.time() * 1000)
        ingested_count = 0
        skipped = 0
        with db.connect() as conn:
            c = conn.cursor()

            name_map = {
                "temperature": ("temperature", "°C", "IMD AWS Temp Sensor"),
                "wind speed": ("wind_speed", "m/s", "Anemometer (10m)"),
                "air pressure": ("air_pressure", "hPa", "Barometric Pressure Sensor"),
                "relative humidity": ("relative_humidity", "%", "Hygrometer (2m)"),
                "wind direction": ("wind_direction", "°", "Wind Vane (10m)")
            }

            for series_name, points in series_map.items():
                key = series_name.lower()
                match = None
                for k, meta in name_map.items():
                    if k in key:
                        match = meta
                        break

                if not match:
                    param, unit, sensor = key.replace(" ", "_"), "units", "Station Instrument"
                else:
                    param, unit, sensor = match

                for pt_ts, val in points:
                    iso_time = datetime.fromtimestamp(pt_ts / 1000.0, tz=timezone.utc).isoformat()
                    try:
                        c.execute("""
                            INSERT OR REPLACE INTO observations
                            (station_id, station_name, timestamp, iso_time, parameter, value, unit,
                             source, dataset, sensor, quality, latitude, longitude, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            info["id"],
                            info["name"],
                            pt_ts,
                            iso_time,
                            param,
                            val,
                            unit,
                            "NCPOR Official Data Portal",
                            "NCPOR-AWS-Live",
                            sensor,
                            "verified_aws_telemetry",
                            info["latitude"],
                            info["longitude"],
                            now_ts
                        ))
                        ingested_count += 1
                    except sqlite3.Error as e:
                        skipped += 1
                        if skipped == 1:
                            log.warning("[%s] NCPOR row insert failed (%s); further failures counted", station_id, e)

            if skipped:
                log.warning("[%s] NCPOR ingest skipped %d rows", station_id, skipped)
            c.execute("""
                INSERT INTO ingestion_logs (station_id, source_url, status, records_ingested, message, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (station_id, url, "success", ingested_count,
                  f"Ingested {ingested_count} observations from NCPOR AWS", now_ts))

        return {
            "status": "success",
            "station_id": station_id,
            "records_ingested": ingested_count,
            "parameters": list(series_map.keys()),
            "source": "https://data.ncpor.res.in"
        }
    except Exception as e:
        log.warning("[%s] NCPOR live ingest failed: %s", station_id, e)
        with db.connect() as conn:
            conn.execute("""
                INSERT INTO ingestion_logs (station_id, source_url, status, records_ingested, message, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (station_id, url, "failed", 0, str(e), int(time.time() * 1000)))
        return {"status": "failed", "error": str(e), "station_id": station_id}

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
