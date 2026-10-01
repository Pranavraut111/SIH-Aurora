"""
Migration 005 — alert engine storage (PROJECT_CONTEXT.md B22, §15).

1. alert_threshold_overrides(station_id, sensor, direction, level, value, …):
   operator overrides on top of the station_config.json defaults.
   station_id '*' applies to every station; a station-specific row wins.
2. station_alerts gains threshold_value, direction, unit, peak_severity,
   updated_at, plus indexes (the table existed but was never written).
3. admin_thresholds (migration 002) is replaced. Values an operator actually
   changed (updated_by != 'default') are copied as '*' overrides:
     generator_temp_warning/critical → gen_temp.high.warning/critical (°C)
     wind_speed_warning/critical_ms  → env_wind.high.warning/critical (×3.6 → km/h,
                                       telemetry unit, see CLAUDE.md units)
   fuel_reorder_days was never read by any code (inventory items carry their
   own reorder thresholds); its value is recorded in the migration details.
   The old table is then dropped.
"""

import time

ID = "005_alert_thresholds"
DESCRIPTION = "alert_threshold_overrides + station_alerts columns; migrate and drop admin_thresholds"

KEY_MAP = {
    "generator_temp_warning": ("gen_temp", "high", "warning", 1.0),
    "generator_temp_critical": ("gen_temp", "high", "critical", 1.0),
    "wind_speed_warning_ms": ("env_wind", "high", "warning", 3.6),
    "wind_speed_critical_ms": ("env_wind", "high", "critical", 3.6),
}


NEW_ALERT_COLUMNS = {
    "threshold_value": "ALTER TABLE station_alerts ADD COLUMN threshold_value REAL",
    "direction": "ALTER TABLE station_alerts ADD COLUMN direction TEXT",
    "unit": "ALTER TABLE station_alerts ADD COLUMN unit TEXT",
    "peak_severity": "ALTER TABLE station_alerts ADD COLUMN peak_severity TEXT",
    "updated_at": "ALTER TABLE station_alerts ADD COLUMN updated_at INTEGER",
}


def _columns(conn, table):
    return {row[0] for row in conn.execute("SELECT name FROM pragma_table_info(?)", (table,))}


def apply(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS alert_threshold_overrides (
            station_id TEXT NOT NULL,
            sensor TEXT NOT NULL,
            direction TEXT NOT NULL CHECK (direction IN ('low', 'high')),
            level TEXT NOT NULL CHECK (level IN ('warning', 'critical')),
            value REAL NOT NULL,
            updated_at INTEGER NOT NULL,
            updated_by TEXT NOT NULL,
            PRIMARY KEY (station_id, sensor, direction, level)
        )
    """)

    added = []
    existing = _columns(conn, "station_alerts")
    for col, statement in NEW_ALERT_COLUMNS.items():
        if col not in existing:
            conn.execute(statement)
            added.append(col)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_alerts_station_time ON station_alerts(station_id, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_alerts_status ON station_alerts(status)")

    migrated, dropped_settings = [], {}
    has_old = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'admin_thresholds'").fetchone()
    if has_old:
        now = int(time.time() * 1000)
        for key, value, updated_at, updated_by in conn.execute(
                "SELECT key, value, updated_at, updated_by FROM admin_thresholds").fetchall():
            if key in KEY_MAP and updated_by != "default":
                sensor, direction, level, factor = KEY_MAP[key]
                conn.execute(
                    "INSERT OR REPLACE INTO alert_threshold_overrides "
                    "(station_id, sensor, direction, level, value, updated_at, updated_by) "
                    "VALUES ('*', ?, ?, ?, ?, ?, ?)",
                    (sensor, direction, level, round(value * factor, 2), updated_at or now, updated_by))
                migrated.append(f"{key} -> {sensor}.{direction}.{level}")
            elif key not in KEY_MAP:
                dropped_settings[key] = value
        conn.execute("DROP TABLE admin_thresholds")
    return {"station_alerts_columns_added": added, "migrated_overrides": migrated,
            "dropped_unused_settings": dropped_settings, "dropped_admin_thresholds": bool(has_old)}
