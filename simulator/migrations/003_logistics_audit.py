"""
Migration 003 — logistics edit audit log (PROJECT_CONTEXT.md §14, P2).

Every edit through POST /api/logistics/update records one row per changed
field: who, when, field, old value, new value. Read via GET /api/logistics/history.
"""

ID = "003_logistics_audit"
DESCRIPTION = "logistics_audit table (who/when/field/old/new for inventory edits)"


def apply(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS logistics_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            station_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            field TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            updated_by TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_logistics_audit_station_time "
                 "ON logistics_audit(station_id, updated_at)")
    return {"created": "logistics_audit"}
