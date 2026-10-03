"""
Migration 007 — privacy-friendly visit counts (judge mode).

visit_counts: aggregate counts only, per IST day, hour and entry point (main page,
a story link, a module link). No IP address, user agent, cookie or visitor id is
stored: visitors are told apart in memory by a hash with a daily random salt that
is never written down (simulator/visits.py).
"""

ID = "007_visit_counts"
DESCRIPTION = "visit_counts (aggregate page visits per IST day/hour/entry, no personal data)"


def apply(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS visit_counts (
            day TEXT NOT NULL,
            hour INTEGER NOT NULL,
            entry TEXT NOT NULL,
            visits INTEGER NOT NULL DEFAULT 0,
            visitors INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, hour, entry)
        )
    """)
    return {"created": "visit_counts"}
