"""
Aurora — simulated satellite link loss with store-and-forward.

A real Antarctic station talks to India over a satellite link that can drop for
minutes or hours. Its edge computer keeps recording and forwards what it stored
once the link returns. This module simulates that pattern for the dashboard:

  link down   the backend keeps receiving the station's readings (from the
              simulator, or its own physics fallback) but holds them, one per
              tick, in a per-station "station-side buffer" instead of publishing
              them. Every page keeps the last data received before the outage,
              marked stale, with the buffer's live size (count and the bytes of
              the actual JSON payloads).
  restore     on the next tick the buffered readings are evaluated and published
              in order (unified_backend.sync_link): alerts get their real
              timestamps, the rolling history fills the gap, and a summary is
              recorded ("Link restored: 142 readings (38 KB) synced, …").

Honest scope: the link and the buffer are simulated; the readings themselves are
the usual model-derived (or SIMULATED) values. Nothing real is disconnected.

Thread safety: the tick (worker thread) buffers and syncs; request handlers cut
and request a restore. One lock guards the state. Only the tick evaluates alerts
or publishes, so the "only the tick advances state" rule holds.
"""

import json
import threading
import time
from collections import deque

import config as app_config


def now_ms() -> int:
    return int(time.time() * 1000)


def payload_bytes(reading: dict) -> int:
    """Size of one reading as it would travel over the link (compact JSON, UTF-8)."""
    return len(json.dumps(reading, separators=(",", ":"), default=str).encode())


class LinkBuffer:
    def __init__(self, stations, max_readings: int | None = None):
        self._lock = threading.Lock()
        self.max_readings = max(1, int(max_readings or app_config.LINK_BUFFER_MAX_READINGS))
        self._st = {sid: self._fresh() for sid in stations}

    @staticmethod
    def _fresh() -> dict:
        return {"up": True, "since": None, "lastContact": None, "startedBy": None, "buffer": deque(),
                "bytes": 0, "dropped": 0, "restorePending": False, "lastSync": None, "syncs": 0,
                "events": deque(maxlen=20)}

    # ── commands (request handlers) ───────────────────────────
    def cut(self, sid: str, started_by: str, last_contact_ms: int | None) -> bool:
        """Take the link down. False if it was already down."""
        with self._lock:
            st = self._st[sid]
            if not st["up"]:
                return False
            st.update(up=False, since=now_ms(), lastContact=last_contact_ms, startedBy=started_by,
                      buffer=deque(), bytes=0, dropped=0, restorePending=False)
            self._event(st, "link", "Satellite link lost (simulated). The station keeps recording on site; "
                                    "the dashboard shows the last data received.")
            return True

    def request_restore(self, sid: str) -> bool:
        """Ask the next tick to bring the link back and sync. False if it was not down."""
        with self._lock:
            st = self._st[sid]
            if st["up"] or st["restorePending"]:
                return False
            st["restorePending"] = True
            return True

    # ── the tick ──────────────────────────────────────────────
    def is_down(self, sid: str) -> bool:
        with self._lock:
            st = self._st[sid]
            return not st["up"] and not st["restorePending"]

    def restore_due(self, sid: str) -> bool:
        with self._lock:
            return self._st[sid]["restorePending"]

    def hold(self, sid: str, reading: dict) -> None:
        """Buffer one tick's reading (once per reading timestamp; oldest dropped past the cap)."""
        n = payload_bytes(reading)
        with self._lock:
            st = self._st[sid]
            buf = st["buffer"]
            if buf and buf[-1][0] >= reading["ts_ms"]:
                return          # the simulator has not sent a newer batch since the last tick
            buf.append((reading["ts_ms"], reading, n))
            st["bytes"] += n
            while len(buf) > self.max_readings:
                _, _, gone = buf.popleft()
                st["bytes"] -= gone
                st["dropped"] += 1

    def take(self, sid: str) -> tuple[list[dict], dict]:
        """Bring the link up and hand over the buffered readings, oldest first, with the
        outage facts (since, last contact, bytes, dropped, who started it)."""
        with self._lock:
            st = self._st[sid]
            readings = [r for _, r, _ in st["buffer"]]
            meta = {"since": st["since"], "lastContact": st["lastContact"], "bytes": st["bytes"],
                    "dropped": st["dropped"], "startedBy": st["startedBy"]}
            st.update(up=True, restorePending=False, buffer=deque(), bytes=0, dropped=0)
            return readings, meta

    def record_sync(self, sid: str, summary: dict) -> None:
        with self._lock:
            st = self._st[sid]
            st["lastSync"] = summary
            st["syncs"] += 1
            self._event(st, "link", summary["message"])

    # ── reads ─────────────────────────────────────────────────
    @staticmethod
    def _event(st: dict, kind: str, message: str) -> None:
        st["events"].append({"type": kind, "message": message, "timestamp": now_ms(), "source": "link"})

    def events(self, sid: str) -> list[dict]:
        with self._lock:
            return list(self._st[sid]["events"])

    def status(self, sid: str) -> dict:
        """Published in every snapshot as `link`."""
        with self._lock:
            st = self._st[sid]
            buf = st["buffer"]
            return {
                "up": st["up"], "syncing": st["restorePending"], "simulated": True,
                "downSince": st["since"] if not st["up"] else None,
                "lastContact": st["lastContact"] if not st["up"] else None,
                "startedBy": st["startedBy"] if not st["up"] else None,
                "bufferedReadings": len(buf), "bufferedBytes": st["bytes"], "droppedReadings": st["dropped"],
                "oldestBuffered": buf[0][0] if buf else None, "newestBuffered": buf[-1][0] if buf else None,
                "bufferCap": self.max_readings,
                "lastSync": st["lastSync"], "syncs": st["syncs"],
            }

    def reset(self, sid: str | None = None) -> None:
        """Forget everything (nightly reset, tests): the link is up, the buffer empty."""
        with self._lock:
            for s in ([sid] if sid else list(self._st)):
                self._st[s] = self._fresh()
