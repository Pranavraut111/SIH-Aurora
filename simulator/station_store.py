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
                "history": {},                 # ingest: "bld.sensor" -> deque[(ts_ms, value)]
                "series": {},                  # published: "bld.sensor" -> deque[(ts_ms, value)]
                "fallback_snapshot": None,     # physics-fallback snapshot (+ _meta)
                "published_snapshot": None,    # what clients see
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
        """Store the snapshot clients will read and append its numeric readings to the
        published series (once per snapshot timestamp: a republished, unchanged
        simulator batch adds no duplicate point)."""
        ts = snapshot.get("timestamp")
        with self._lock:
            st = self._stations[sid]
            st["published_snapshot"] = snapshot
            if ts is None:
                return
            series = st["series"]
            readings = dict(snapshot.get("sensors") or {})
            # The replay clock is kept as a series too, so history can be re-timed to it.
            replay_ms = (snapshot.get("replay") or {}).get("timeMs")
            if replay_ms is not None:
                readings["replay"] = {"timeMs": replay_ms}
            for bld, sensors in readings.items():
                for sensor, value in sensors.items():
                    if not isinstance(value, (int, float)) or isinstance(value, bool):
                        continue
                    key = f"{bld}.{sensor}"
                    dq = series.get(key)
                    if dq is None:
                        dq = series[key] = deque(maxlen=self._history_max)
                    if dq and dq[-1][0] >= ts:
                        continue
                    dq.append((ts, value))

    def series(self, sid: str, key: str) -> list:
        """Copy of the published series for 'building.sensor' (oldest first)."""
        with self._lock:
            dq = self._stations[sid]["series"].get(key)
            return list(dq) if dq else []

    def get_published(self, sid: str):
        with self._lock:
            return self._stations[sid]["published_snapshot"]

