"""
Aurora — tiny SQLite migration runner.

Migrations are files named NNN_description.py in this folder. Each defines:
    ID: str            unique id (e.g. "001_fix_era5_wind_units")
    DESCRIPTION: str
    apply(conn) -> dict   performs the change WITHOUT committing; returns stats

Idempotency: applied ids are recorded in `schema_migrations`. The check and
the change run in ONE `BEGIN IMMEDIATE` transaction, so two processes starting
at once can never both apply a migration. `init_db()` calls run_migrations().
"""

import importlib.util
import json
import logging
import re
import sqlite3
import time
from pathlib import Path

log = logging.getLogger("aurora.migrations")

MIGRATIONS_DIR = Path(__file__).resolve().parent
_FILE_RE = re.compile(r"^\d{3}_[a-z0-9_]+\.py$")


def _discover():
    mods = []
    for path in sorted(MIGRATIONS_DIR.iterdir()):
        if _FILE_RE.match(path.name):
            spec = importlib.util.spec_from_file_location(f"aurora_migration_{path.stem}", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mods.append(mod)
    return mods


def ensure_table(conn: sqlite3.Connection):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at INTEGER NOT NULL,
            details TEXT
        )
    """)
    conn.commit()


def applied_ids(conn: sqlite3.Connection) -> set:
    ensure_table(conn)
    return {row[0] for row in conn.execute("SELECT id FROM schema_migrations")}


def run_migrations(conn: sqlite3.Connection, only=None) -> list:
    """Apply pending migrations in order. Returns [(id, status, details)]."""
    ensure_table(conn)
    results = []
    for mod in _discover():
        if only is not None and mod.ID not in only:
            continue
        conn.execute("BEGIN IMMEDIATE")
        try:
            done = conn.execute("SELECT 1 FROM schema_migrations WHERE id = ?", (mod.ID,)).fetchone()
            if done:
                conn.rollback()
                results.append((mod.ID, "already-applied", None))
                continue
            details = mod.apply(conn)
            conn.execute(
                "INSERT INTO schema_migrations (id, description, applied_at, details) VALUES (?, ?, ?, ?)",
                (mod.ID, mod.DESCRIPTION, int(time.time() * 1000), json.dumps(details)),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            log.exception("Migration %s failed; rolled back", mod.ID)
            raise
        log.info("Applied migration %s: %s", mod.ID, details)
        results.append((mod.ID, "applied", details))
    return results
