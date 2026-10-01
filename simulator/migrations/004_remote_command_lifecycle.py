"""
Migration 004 — simulated remote-command lifecycle.

Commands go 'queued (simulated)' → 'acknowledged (simulated)' (recorded in
acknowledged_at). Nothing is ever "executed": there is no station link.

Legacy demo rows claimed status 'executed' / "applied to station". They are
relabelled 'acknowledged (simulated)'; the original status and log text are
kept inside response_log, so no information is lost.
"""

ID = "004_remote_command_lifecycle"
DESCRIPTION = "remote_commands.acknowledged_at + honest relabel of legacy 'executed' demo rows"

LEGACY_STATUSES = ("executed", "dispatched", "pending", "failed")


def apply(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(remote_commands)")}
    added = False
    if "acknowledged_at" not in cols:
        conn.execute("ALTER TABLE remote_commands ADD COLUMN acknowledged_at INTEGER")
        added = True
    cur = conn.execute(
        """
        UPDATE remote_commands
        SET response_log = 'Legacy demo row relabelled by migration 004: it claimed status "' || status ||
                           '", but no station link exists and nothing was executed. Original log: ' ||
                           COALESCE(response_log, ''),
            acknowledged_at = COALESCE(dispatched_at, created_at),
            status = 'acknowledged (simulated)',
            dispatched_at = NULL,
            executed_at = NULL
        WHERE status IN (?, ?, ?, ?)
        """,
        LEGACY_STATUSES,
    )
    return {"added_acknowledged_at": added, "relabelled_legacy_rows": cur.rowcount}
