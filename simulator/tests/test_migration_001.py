"""B7 — migration 001: km/h → m/s for legacy ERA5 wind rows, honest labels, idempotent."""

import sqlite3

import pytest

from conftest import insert_obs
from migrations import run_migrations, applied_ids

MIG_ID = "001_fix_era5_wind_units"
OLD_SOURCE = "NCPOR / ECMWF Polar Climate Reanalysis"
ERA5 = "Antarctic-ERA5-Reanalysis"


@pytest.fixture
def legacy_db(tmp_path):
    """A DB shaped like the pre-fix one: observations table, NO migration ledger,
    ERA5 rows with the old label and km/h wind stored as 'm/s'."""
    db = tmp_path / "legacy.db"
    conn = sqlite3.connect(str(db))
    conn.execute("""
        CREATE TABLE observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT, station_id TEXT NOT NULL, station_name TEXT NOT NULL,
            timestamp INTEGER NOT NULL, iso_time TEXT NOT NULL, parameter TEXT NOT NULL, value REAL NOT NULL,
            unit TEXT NOT NULL, source TEXT NOT NULL, dataset TEXT NOT NULL, sensor TEXT,
            quality TEXT NOT NULL DEFAULT 'verified', latitude REAL NOT NULL, longitude REAL NOT NULL,
            created_at INTEGER NOT NULL, UNIQUE(station_id, timestamp, parameter, dataset))
    """)
    conn.commit()
    conn.close()
    insert_obs(db, [
        ("maitri", 1_000, "wind_speed", 36.0, "m/s", OLD_SOURCE, ERA5, "10m Anemometer", "quality_controlled"),
        ("maitri", 2_000, "wind_speed", 72.0, "m/s", OLD_SOURCE, ERA5, "10m Anemometer", "quality_controlled"),
        ("maitri", 1_000, "temperature", -20.0, "°C", OLD_SOURCE, ERA5, "IMD/ERA5 Temperature", "quality_controlled"),
        # NCPOR live rows must be left untouched
        ("maitri", 3_000, "wind_speed", 12.5, "m/s", "NCPOR Official Data Portal", "NCPOR-AWS-Live",
         "Anemometer (10m)", "verified_aws_telemetry"),
    ])
    return db


def _rows(db, dataset):
    conn = sqlite3.connect(str(db))
    try:
        return conn.execute(
            "SELECT timestamp, parameter, value, unit, source, sensor, quality, dataset FROM observations "
            "WHERE dataset = ? ORDER BY dataset, parameter, timestamp", (dataset,)).fetchall()
    finally:
        conn.close()


def test_converts_wind_and_relabels(legacy_db):
    conn = sqlite3.connect(str(legacy_db))
    try:
        results = run_migrations(conn, only={MIG_ID})
    finally:
        conn.close()
    assert results[0][:2] == (MIG_ID, "applied")
    era5 = _rows(legacy_db, ERA5)
    winds = {ts: v for ts, p, v, *_ in era5 if p == "wind_speed"}
    assert winds == {1_000: pytest.approx(10.0), 2_000: pytest.approx(20.0)}
    for _, param, value, unit, source, sensor, quality, _ in era5:
        assert source == "Open-Meteo ERA5 reanalysis"
        assert quality == "reanalysis"
        assert sensor.startswith("ERA5 ")
        if param == "temperature":
            assert value == pytest.approx(-20.0)   # non-wind values unchanged


def test_ncpor_rows_untouched(legacy_db):
    before = _rows(legacy_db, "NCPOR-AWS-Live")
    conn = sqlite3.connect(str(legacy_db))
    try:
        run_migrations(conn, only={MIG_ID})
    finally:
        conn.close()
    assert _rows(legacy_db, "NCPOR-AWS-Live") == before


def test_idempotent_via_ledger(legacy_db):
    conn = sqlite3.connect(str(legacy_db))
    try:
        run_migrations(conn, only={MIG_ID})
        second = run_migrations(conn, only={MIG_ID})
        assert MIG_ID in applied_ids(conn)
    finally:
        conn.close()
    assert second[0][:2] == (MIG_ID, "already-applied")
    winds = [v for _, p, v, *_ in _rows(legacy_db, ERA5) if p == "wind_speed"]
    assert winds == [pytest.approx(10.0), pytest.approx(20.0)]


def test_never_converts_twice_even_without_ledger(legacy_db):
    """Second guard: only OLD-labelled rows match, so deleting the ledger row
    and re-running must not divide by 3.6 again."""
    conn = sqlite3.connect(str(legacy_db))
    try:
        run_migrations(conn, only={MIG_ID})
        conn.execute("DELETE FROM schema_migrations WHERE id = ?", (MIG_ID,))
        conn.commit()
        rerun = run_migrations(conn, only={MIG_ID})
    finally:
        conn.close()
    assert rerun[0][1] == "applied"
    assert rerun[0][2]["converted_wind_rows"] == 0
    winds = [v for _, p, v, *_ in _rows(legacy_db, ERA5) if p == "wind_speed"]
    assert winds == [pytest.approx(10.0), pytest.approx(20.0)]


def test_fresh_db_records_migration_without_converting(temp_db):
    """init_db() on a brand-new DB applies 001 as a no-op, so rows ingested by the
    fixed importer (already m/s) can never be converted later."""
    conn = sqlite3.connect(str(temp_db))
    try:
        assert MIG_ID in applied_ids(conn)
        details = conn.execute("SELECT details FROM schema_migrations WHERE id = ?", (MIG_ID,)).fetchone()[0]
    finally:
        conn.close()
    assert '"converted_wind_rows": 0' in details
