"""
Aurora — the ONE SQLite helper (PROJECT_CONTEXT.md §14/§15).

    from db import connect
    with connect() as conn:                 # commits on success, rolls back on error
        conn.execute("SELECT ... WHERE id = ?", (item_id,))

- One connection per `with` block, never shared between threads (FastAPI runs
  sync handlers in a threadpool and the tick in another thread), so no
  connection-level locking is needed.
- WAL journal mode (readers don't block the writer) and a busy timeout, so
  concurrent writers wait instead of failing with "database is locked".
- Rows are sqlite3.Row (dict-like). All SQL must use `?` parameters — never
  build SQL with f-strings or string concatenation.

DB_PATH is read at call time, so tests can point it at a temp file.
"""

import contextlib
import logging
import sqlite3
import threading
from pathlib import Path

import config as app_config

log = logging.getLogger("aurora.db")

DB_PATH: Path = app_config.DB_PATH
BUSY_TIMEOUT_S = 5.0

_wal_lock = threading.Lock()
_wal_paths = set()


def _ensure_wal(conn: sqlite3.Connection, path: str) -> None:
    """journal_mode=WAL is persistent in the file; set it once per path per process."""
    if path in _wal_paths:
        return
    with _wal_lock:
        if path in _wal_paths:
            return
        mode = conn.execute("PRAGMA journal_mode = WAL").fetchone()[0]
        if str(mode).lower() != "wal":
            log.warning("SQLite at %s did not switch to WAL (journal_mode=%s)", path, mode)
        _wal_paths.add(path)


@contextlib.contextmanager
def connect(path=None):
    """Open a connection, yield it, commit on success, roll back on error, always close."""
    target = str(path or DB_PATH)
    conn = sqlite3.connect(target, timeout=BUSY_TIMEOUT_S)
    try:
        conn.row_factory = sqlite3.Row
        _ensure_wal(conn, target)
        conn.execute("PRAGMA foreign_keys = ON")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
