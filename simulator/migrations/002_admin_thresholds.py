"""
Migration 002 — persist admin alert thresholds (PROJECT_CONTEXT.md B22).

Creates `admin_thresholds(key, value, updated_at, updated_by)` and seeds the
defaults that were previously an in-memory dict in unified_backend.py.
Seeding uses INSERT OR IGNORE, so existing operator values are never overwritten.
"""

import time

ID = "002_admin_thresholds"
DESCRIPTION = "admin_thresholds table with default alert thresholds"

DEFAULTS = {
    "generator_temp_warning": 88.0,
    "generator_temp_critical": 95.0,
    "wind_speed_warning_ms": 18.0,
    "wind_speed_critical_ms": 25.0,
    "fuel_reorder_days": 45.0,
}


def apply(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS admin_thresholds (
            key TEXT PRIMARY KEY,
            value REAL NOT NULL,
            updated_at INTEGER NOT NULL,
            updated_by TEXT NOT NULL
        )
    """)
    now = int(time.time() * 1000)
    seeded = 0
    for key, value in DEFAULTS.items():
        cur = conn.execute(
            "INSERT OR IGNORE INTO admin_thresholds (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)",
            (key, value, now, "default"))
        seeded += cur.rowcount
    return {"seeded": seeded}
