"""
Aurora — judge mode: the visitor sandbox and public demo scenarios.

The live deployment is opened by judges on their own, at any time. They must be able
to try everything without the ADMIN_TOKEN, and without changing what other visitors see.

Visitor sandbox (VISITOR_SANDBOX=true)
    An anonymous write (threshold change, ledger edit, alert acknowledgement, remote
    command) is validated exactly like a real one, then stored in that visitor's
    sandbox session instead of the shared tables. The session id is random, lives in an
    httpOnly SameSite cookie, and expires SANDBOX_TTL_S after creation. Responses for
    that visitor overlay the session's changes on the shared state (unified_backend.py);
    the shared state and every other visitor are never affected. Sessions are capped
    (SANDBOX_MAX_SESSIONS) and expired ones are deleted by the backend tick.

Public demo scenarios
    Anonymous visitors may run only the predefined Demo Control scenarios, which change
    the shared simulator, so: one active scenario per station, PUBLIC_DEMO_DURATION_S
    long and then reset automatically, PUBLIC_DEMO_COOLDOWN_S per client IP. The state
    is published in every telemetry snapshot so every visitor sees the running banner.
"""

import json
import logging
import secrets
import threading
import time
from collections import deque

import config as app_config
import db

log = logging.getLogger("aurora.judge_mode")

COOKIE_NAME = "aurora_sandbox"
PUBLIC_SCENARIOS = ("generator_failure", "heating_failure", "blizzard", "water_crisis", "co2_spike")
KINDS = ("threshold", "ledger", "ledger_audit", "ack", "command")


def now_ms() -> int:
    return int(time.time() * 1000)


def fmt_mmss(seconds: float) -> str:
    s = max(0, int(round(seconds)))
    return f"{s // 60}:{s % 60:02d}"


class SandboxFull(Exception):
    """Too many live sessions."""


class SandboxRateLimited(Exception):
    def __init__(self, retry_after_s: int):
        super().__init__(retry_after_s)
        self.retry_after_s = retry_after_s


# ═══════════════════════════════════════════════════════════════
#  Visitor sandbox store
# ═══════════════════════════════════════════════════════════════

class SandboxStore:
    def __init__(self):
        self._writes: dict[str, deque] = {}
        # (session, station, sensor) → {"level", "raisedAt"}: when a visitor's own threshold
        # alert started, so its id and age stay stable between reads. Bounded by the
        # session cap; dropped with the session.
        self._alert_since: dict[tuple[str, str, str], dict] = {}
        self._lock = threading.Lock()

    # ── sessions ──────────────────────────────────────────────
    @staticmethod
    def valid(session_id: str | None) -> str | None:
        """The session id if it exists and has not expired, else None."""
        if not session_id or len(session_id) > 64:
            return None
        with db.connect() as conn:
            row = conn.execute("SELECT expires_at FROM sandbox_sessions WHERE id = ?", (session_id,)).fetchone()
            if row is None or row["expires_at"] <= now_ms():
                return None
            conn.execute("UPDATE sandbox_sessions SET last_seen = ? WHERE id = ?", (now_ms(), session_id))
        return session_id

    def create(self) -> tuple[str, int]:
        """A new session (id, expires_at ms). SandboxFull when the cap is reached."""
        ts = now_ms()
        with db.connect() as conn:
            live = conn.execute("SELECT COUNT(*) FROM sandbox_sessions WHERE expires_at > ?", (ts,)).fetchone()[0]
            if live >= app_config.SANDBOX_MAX_SESSIONS:
                self.cleanup()
                live = conn.execute("SELECT COUNT(*) FROM sandbox_sessions WHERE expires_at > ?", (ts,)).fetchone()[0]
                if live >= app_config.SANDBOX_MAX_SESSIONS:
                    raise SandboxFull()
            sid = secrets.token_urlsafe(24)
            expires = ts + app_config.SANDBOX_TTL_S * 1000
            conn.execute("INSERT INTO sandbox_sessions (id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?)",
                         (sid, ts, expires, ts))
        log.info("Sandbox session created (%d live)", live + 1)
        return sid, expires

    @staticmethod
    def expires_at(session_id: str) -> int | None:
        with db.connect() as conn:
            row = conn.execute("SELECT expires_at FROM sandbox_sessions WHERE id = ?", (session_id,)).fetchone()
        return row["expires_at"] if row else None

    def reset(self, session_id: str) -> int:
        """Delete the session and everything in it."""
        with db.connect() as conn:
            n = conn.execute("DELETE FROM sandbox_changes WHERE session_id = ?", (session_id,)).rowcount
            conn.execute("DELETE FROM sandbox_sessions WHERE id = ?", (session_id,))
        with self._lock:
            self._writes.pop(session_id, None)
            self._drop_alert_state(session_id)
        return n

    def cleanup(self) -> int:
        """Delete expired sessions (their changes go with them). Returns the number removed."""
        ts = now_ms()
        with db.connect() as conn:
            ids = [r["id"] for r in conn.execute("SELECT id FROM sandbox_sessions WHERE expires_at <= ?", (ts,))]
            if ids:
                conn.executemany("DELETE FROM sandbox_changes WHERE session_id = ?", [(i,) for i in ids])
                conn.executemany("DELETE FROM sandbox_sessions WHERE id = ?", [(i,) for i in ids])
            live = {r["id"] for r in conn.execute("SELECT id FROM sandbox_sessions")}
        with self._lock:
            # Memory follows the table, also for sessions another process removed (nightly_reset.py).
            for i in set(self._writes) - live:
                self._writes.pop(i, None)
            for i in {k[0] for k in self._alert_since} - live:
                self._drop_alert_state(i)
        if ids:
            log.info("Sandbox: %d expired session(s) removed", len(ids))
        return len(ids)

    def _drop_alert_state(self, session_id: str, station_id: str | None = None) -> None:
        """Forget a session's alert start times (lock held)."""
        for k in [k for k in self._alert_since if k[0] == session_id and station_id in (None, k[1])]:
            del self._alert_since[k]

    def alert_since(self, session_id: str, station_id: str, sensor: str, level: str | None, ts_ms: int) -> int | None:
        """When this visitor's own-threshold alert on `sensor` was raised (ms), or None once
        it is back to normal. Escalation keeps the start time, like a shared alert."""
        key = (session_id, station_id, sensor)
        with self._lock:
            if level is None:
                self._alert_since.pop(key, None)
                return None
            rec = self._alert_since.setdefault(key, {"level": level, "raisedAt": ts_ms})
            rec["level"] = level
            return rec["raisedAt"]

    def forget_alerts(self, session_id: str, station_id: str | None = None) -> None:
        with self._lock:
            self._drop_alert_state(session_id, station_id)

    @staticmethod
    def live_count() -> int:
        with db.connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM sandbox_sessions WHERE expires_at > ?", (now_ms(),)).fetchone()[0]

    # ── rate limit ────────────────────────────────────────────
    def check_rate(self, session_id: str) -> None:
        """SandboxRateLimited past SANDBOX_WRITES_PER_MIN writes in a rolling minute."""
        ts = time.monotonic()
        with self._lock:
            q = self._writes.setdefault(session_id, deque())
            while q and ts - q[0] > 60:
                q.popleft()
            if len(q) >= app_config.SANDBOX_WRITES_PER_MIN:
                raise SandboxRateLimited(max(1, int(60 - (ts - q[0])) + 1))
            q.append(ts)

    # ── changes ───────────────────────────────────────────────
    @staticmethod
    def put(session_id: str, kind: str, key: str, value: dict) -> None:
        assert kind in KINDS
        with db.connect() as conn:
            conn.execute("INSERT OR REPLACE INTO sandbox_changes (session_id, kind, key, value, created_at) "
                         "VALUES (?, ?, ?, ?, ?)", (session_id, kind, key, json.dumps(value), now_ms()))

    @staticmethod
    def delete(session_id: str, kind: str, key_prefix: str = "") -> int:
        with db.connect() as conn:
            pattern = key_prefix.replace("%", r"\%").replace("_", r"\_") + "%"
            return conn.execute("DELETE FROM sandbox_changes WHERE session_id = ? AND kind = ? "
                                "AND key LIKE ? ESCAPE '\\'", (session_id, kind, pattern)).rowcount

    @staticmethod
    def get(session_id: str | None, kind: str) -> dict[str, dict]:
        """{key: value} of this session's changes of one kind (empty without a session)."""
        if not session_id:
            return {}
        with db.connect() as conn:
            rows = conn.execute("SELECT key, value FROM sandbox_changes WHERE session_id = ? AND kind = ? "
                                "ORDER BY created_at, key", (session_id, kind)).fetchall()
        return {r["key"]: json.loads(r["value"]) for r in rows}

    @staticmethod
    def counts(session_id: str | None) -> dict[str, int]:
        if not session_id:
            return {}
        with db.connect() as conn:
            rows = conn.execute("SELECT kind, COUNT(*) AS n FROM sandbox_changes WHERE session_id = ? GROUP BY kind",
                                (session_id,)).fetchall()
        return {r["kind"]: r["n"] for r in rows}


SANDBOX = SandboxStore()


# ═══════════════════════════════════════════════════════════════
#  Public demo scenarios
# ═══════════════════════════════════════════════════════════════

class DemoBusy(Exception):
    def __init__(self, message: str, retry_after_s: int):
        super().__init__(message)
        self.message = message
        self.retry_after_s = retry_after_s


class DemoCooldown(DemoBusy):
    pass


class PublicDemo:
    """Which scenario runs on which station, who started it and when it ends."""

    def __init__(self):
        self._lock = threading.Lock()
        self.active: dict[str, dict] = {}       # station → record
        self._last_by_ip: dict[str, float] = {}

    def _check_visitor(self, sid: str, station_name: str, ip: str) -> None:
        """Raise DemoBusy / DemoCooldown if a visitor may not start a scenario now (hold the lock)."""
        ts = time.time()
        rec = self.active.get(sid)
        if rec and rec["endsAt"] > ts * 1000:
            left = (rec["endsAt"] - ts * 1000) / 1000
            raise DemoBusy(f"Another scenario is running at {station_name}; try again in {fmt_mmss(left)}.",
                           int(left) + 1)
        last = self._last_by_ip.get(ip)
        if last is not None and ts - last < app_config.PUBLIC_DEMO_COOLDOWN_S:
            left = app_config.PUBLIC_DEMO_COOLDOWN_S - (ts - last)
            raise DemoCooldown(f"You started a scenario a moment ago; you can start another in {fmt_mmss(left)}.",
                               int(left) + 1)

    def start(self, sid: str, scenario_id: str, name: str, *, started_by: str, duration_s: float,
              ip: str | None = None, station_name: str = "") -> dict:
        """Record a running scenario. For a visitor the lock and cooldown are checked in the
        same critical section, so two visitors clicking at once cannot both start one."""
        ts = now_ms()
        rec = {"stationId": sid, "scenario": scenario_id, "name": name, "startedBy": started_by,
               "startedAt": ts, "endsAt": ts + int(duration_s * 1000), "simulated": True}
        with self._lock:
            if started_by == "visitor":
                self._check_visitor(sid, station_name or sid, ip or "unknown")
                self._last_by_ip[ip or "unknown"] = time.time()
                cutoff = time.time() - app_config.PUBLIC_DEMO_COOLDOWN_S
                for k in [k for k, v in self._last_by_ip.items() if v < cutoff]:
                    self._last_by_ip.pop(k, None)
            self.active[sid] = rec
        return dict(rec)

    def set_name(self, sid: str, name: str) -> dict | None:
        """The simulator's display name for the running scenario (known only after the injection)."""
        with self._lock:
            rec = self.active.get(sid)
            if rec:
                rec["name"] = name
            return dict(rec) if rec else None

    def forget_start(self, sid: str, ip: str | None) -> None:
        """Undo a start whose injection failed: free the station and the visitor's cooldown."""
        with self._lock:
            self.active.pop(sid, None)
            if ip:
                self._last_by_ip.pop(ip, None)

    def get(self, sid: str) -> dict | None:
        with self._lock:
            return dict(self.active[sid]) if sid in self.active else None

    def clear(self, sid: str) -> dict | None:
        with self._lock:
            return self.active.pop(sid, None)

    def due(self, ts_ms: int | None = None) -> list[str]:
        """Stations whose scenario has run its time."""
        ts_ms = ts_ms or now_ms()
        with self._lock:
            return [sid for sid, r in self.active.items() if r["endsAt"] <= ts_ms]

    def status(self) -> dict:
        """Published in every snapshot: {stationId: record | None} for every running scenario."""
        ts = now_ms()
        with self._lock:
            return {sid: {**r, "remainingS": max(0, round((r["endsAt"] - ts) / 1000))}
                    for sid, r in self.active.items()}

    def reset_cooldowns(self) -> None:
        with self._lock:
            self._last_by_ip.clear()


DEMO = PublicDemo()
