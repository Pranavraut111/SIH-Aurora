"""
Migration 006 — visitor sandbox sessions (judge mode).

sandbox_sessions: one row per anonymous visitor session (random id in an httpOnly
cookie), with a hard expiry. sandbox_changes: that session's private writes
(threshold overrides, ledger values and their audit entries, alert
acknowledgements, simulated remote commands) as JSON, overlaid on the shared state
for that visitor only. Expired sessions are deleted by the backend tick.
"""

ID = "006_visitor_sandbox"
DESCRIPTION = "sandbox_sessions + sandbox_changes (per-visitor private writes)"


def apply(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sandbox_sessions (
            id TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            last_seen INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sandbox_changes (
            session_id TEXT NOT NULL REFERENCES sandbox_sessions(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (session_id, kind, key)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sandbox_sessions_expiry ON sandbox_sessions(expires_at)")
    return {"created": "sandbox_sessions, sandbox_changes"}
