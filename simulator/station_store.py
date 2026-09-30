"""
Aurora — thread-safe per-station state store for the unified backend.

Concurrency model (see PROJECT_CONTEXT.md B1/B2 fix):
- FastAPI runs `async def` handlers (batch POST, WebSocket, tick) on the event
  loop, plain `def` handlers in a threadpool, and the tick runs physics in a
  worker thread. State is therefore touched from several threads, so a single
  threading.Lock guards everything here. Critical sections are tiny and never
  await or do IO.
- Snapshots are IMMUTABLE once stored: they are always replaced, never mutated,
  so readers can return them without copying.
"""

import threading
import time
from collections import deque


class StationStore:
    def __init__(self, station_ids, history_max_points: int = 300):
        self._lock = threading.Lock()
        self._history_max = history_max_points
        self._stations = {
            sid: {
                "latest_batch": None,          # validated batch dict
                "received_monotonic": None,    # time.monotonic() of last batch
                "received_ms": None,           # wall-clock ms of last batch
                "history": {},                 # "bld.sensor" -> deque[(ts_ms, value)]
                "fallback_snapshot": None,     # physics-fallback snapshot (+ _meta)
                "published_snapshot": None,    # what clients see
                "connected": True,             # simulated link flag
            }
            for sid in station_ids
        }

    # ── Simulator batches ─────────────────────────────────────
    def record_batch(self, sid: str, batch: dict) -> int:
        """Store the latest batch and append every reading to history.
        Returns the number of history points for this station."""
        now_mono = time.monotonic()
        now_ms = int(time.time() * 1000)
        ts = batch.get("timestamp") or now_ms
        with self._lock:
            st = self._stations[sid]
            st["latest_batch"] = batch
            st["received_monotonic"] = now_mono
            st["received_ms"] = now_ms
            hist = st["history"]
            for bld, sensors in batch.get("readings", {}).items():
                for sensor, reading in sensors.items():
                    key = f"{bld}.{sensor}"
                    dq = hist.get(key)
                    if dq is None:
                        dq = hist[key] = deque(maxlen=self._history_max)
                    dq.append((ts, reading["value"]))
            return sum(len(d) for d in hist.values())

    def latest_batch(self, sid: str):
        with self._lock:
            return self._stations[sid]["latest_batch"]

    def batch_age(self, sid: str):
        """Seconds since the last batch, or None if never received."""
        with self._lock:
            t = self._stations[sid]["received_monotonic"]
        return None if t is None else max(0.0, time.monotonic() - t)

    def history_len(self, sid: str) -> int:
        with self._lock:
            return sum(len(d) for d in self._stations[sid]["history"].values())

    def history(self, sid: str, key: str) -> list:
        """Copy of the rolling history for 'building.sensor' (oldest first)."""
        with self._lock:
            dq = self._stations[sid]["history"].get(key)
            return list(dq) if dq else []

    # ── Snapshots ─────────────────────────────────────────────
    def set_fallback(self, sid: str, snapshot: dict):
        with self._lock:
            self._stations[sid]["fallback_snapshot"] = snapshot

    def get_fallback(self, sid: str):
        with self._lock:
            return self._stations[sid]["fallback_snapshot"]

    def publish(self, sid: str, snapshot: dict):
        with self._lock:
            self._stations[sid]["published_snapshot"] = snapshot

    def get_published(self, sid: str):
        with self._lock:
            return self._stations[sid]["published_snapshot"]

    # ── Simulated satellite link flag ─────────────────────────
    def toggle_connected(self, sid: str) -> bool:
        with self._lock:
            st = self._stations[sid]
            st["connected"] = not st["connected"]
            return st["connected"]

    def is_connected(self, sid: str) -> bool:
        with self._lock:
            return self._stations[sid]["connected"]
