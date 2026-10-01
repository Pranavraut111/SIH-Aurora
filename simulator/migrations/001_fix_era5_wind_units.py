"""
Migration 001 — fix ERA5 wind units and provenance labels (PROJECT_CONTEXT.md B7).

Problem: the old importer stored Open-Meteo ERA5 wind speed in km/h but labelled
it m/s (the unit check looked in the wrong dict), and labelled ERA5 rows as
"NCPOR / ECMWF Polar Climate Reanalysis" / "IMD/ERA5 Temperature" /
"quality_controlled" — implying station instruments.

Fix (single UPDATE, inside the runner's transaction):
- wind_speed: value km/h → m/s (÷ 3.6), unit 'm/s'
- all ERA5 parameters: source "Open-Meteo ERA5 reanalysis", honest sensor
  names, quality "reanalysis"; dataset unchanged.
- NCPOR-AWS-Live rows are NOT touched.

Idempotency (two independent guards):
1. The runner records "001_fix_era5_wind_units" in schema_migrations and skips it next time.
2. Only rows still carrying the OLD source label are matched; after the update
   they no longer match, so a row can never be converted twice — even if the
   ledger were lost. Rows written by the fixed importer are never matched.

Run manually:  python simulator/migrations/001_fix_era5_wind_units.py [--db PATH]
(It also runs automatically from ncpor_ingestor.init_db().)
"""

ID = "001_fix_era5_wind_units"
DESCRIPTION = "ERA5 wind km/h→m/s and honest ERA5 provenance labels"

OLD_SOURCE = "NCPOR / ECMWF Polar Climate Reanalysis"
DATASET = "Antarctic-ERA5-Reanalysis"
NEW_SOURCE = "Open-Meteo ERA5 reanalysis"
NEW_QUALITY = "reanalysis"
NEW_SENSORS = {
    "temperature": "ERA5 2 m air temperature",
    "wind_speed": "ERA5 10 m wind speed",
    "air_pressure": "ERA5 surface pressure",
    "relative_humidity": "ERA5 2 m relative humidity",
    "wind_direction": "ERA5 10 m wind direction",
}


def _wind_stats(conn):
    row = conn.execute(
        "SELECT COUNT(*), AVG(value) FROM observations WHERE dataset = ? AND parameter = 'wind_speed'",
        (DATASET,),
    ).fetchone()
    return {"rows": row[0], "mean": None if row[1] is None else round(row[1], 3)}


def apply(conn):
    has_table = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'observations'"
    ).fetchone()
    if not has_table:
        return {"converted_wind_rows": 0, "relabelled_rows": 0, "note": "no observations table"}

    before = _wind_stats(conn)
    wind_rows = conn.execute(
        "SELECT COUNT(*) FROM observations WHERE dataset = ? AND source = ? AND parameter = 'wind_speed'",
        (DATASET, OLD_SOURCE),
    ).fetchone()[0]

    sensor_case = " ".join(f"WHEN '{p}' THEN '{name}'" for p, name in NEW_SENSORS.items())
    cur = conn.execute(
        f"""
        UPDATE observations
        SET value   = CASE WHEN parameter = 'wind_speed' THEN ROUND(value / 3.6, 2) ELSE value END,
            unit    = CASE WHEN parameter = 'wind_speed' THEN 'm/s' ELSE unit END,
            source  = ?,
            sensor  = CASE parameter {sensor_case} ELSE sensor END,
            quality = ?
        WHERE dataset = ? AND source = ?
        """,
        (NEW_SOURCE, NEW_QUALITY, DATASET, OLD_SOURCE),
    )
    after = _wind_stats(conn)
    return {
        "converted_wind_rows": wind_rows,
        "relabelled_rows": cur.rowcount,
        "era5_wind_before": before,
        "era5_wind_after": after,
    }


if __name__ == "__main__":
    import argparse
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # simulator/
    from config import DB_PATH
    import db
    from migrations import run_migrations

    ap = argparse.ArgumentParser(description=DESCRIPTION)
    ap.add_argument("--db", default=str(DB_PATH), help="SQLite DB path (default: config DB_PATH)")
    args = ap.parse_args()

    with db.connect(args.db) as conn:
        for mid, status, details in run_migrations(conn, only={ID}):
            print(f"{mid}: {status}")
            if details:
                for k, v in details.items():
                    print(f"  {k}: {v}")
