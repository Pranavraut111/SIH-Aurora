"""
Aurora — scheduled NCPOR live-page sync (both stations).

The backend fetches each station's NCPOR AWS live page every NCPOR_SYNC_INTERVAL_MIN
minutes (ncpor_ingestor.ingest_live_station: parse, plausibility checks, store). After
a failed attempt the next one backs off (interval × 2^failures, capped at
NCPOR_SYNC_MAX_BACKOFF_MIN); a failure stores nothing, so the last good data stays and
the UI says how old it is. The team's manual "Sync now" goes through the same path.

Status (GET /api/ncpor/status) comes from ingestion_logs (survives restarts) plus the
next scheduled time kept here.
"""

import logging
import threading
import time

import config as app_config
import db
from ncpor_ingestor import NCPOR_DATASET, ingest_live_station

log = logging.getLogger("aurora.ncpor_sync")

FIRST_SYNC_DELAY_S = 20          # after startup, so a fresh deployment syncs within a minute


def now_ms() -> int:
    return int(time.time() * 1000)


class NcporSync:
    def __init__(self, stations, interval_min: float | None = None, max_backoff_min: float | None = None):
        self.stations = tuple(stations)
        self.interval_s = 60 * (app_config.NCPOR_SYNC_INTERVAL_MIN if interval_min is None else interval_min)
        self.max_backoff_s = 60 * (app_config.NCPOR_SYNC_MAX_BACKOFF_MIN if max_backoff_min is None
                                   else max_backoff_min)
        self._lock = threading.Lock()
        self._failures = {sid: 0 for sid in self.stations}
        self._next = {sid: None for sid in self.stations}         # epoch ms
        self._running: set[str] = set()

    @property
    def enabled(self) -> bool:
        return self.interval_s > 0

    def delay_after(self, failures: int) -> float:
        """Seconds until the next attempt after `failures` consecutive failures."""
        if failures <= 0:
            return self.interval_s
        return min(self.max_backoff_s, self.interval_s * 2 ** failures)

    def start(self, first_delay_s: float = FIRST_SYNC_DELAY_S) -> None:
        with self._lock:
            for sid in self.stations:
                self._next[sid] = now_ms() + int(first_delay_s * 1000)

    def due(self, ts_ms: int | None = None) -> list[str]:
        ts_ms = ts_ms or now_ms()
        with self._lock:
            return [sid for sid in self.stations
                    if self.enabled and self._next[sid] is not None and self._next[sid] <= ts_ms
                    and sid not in self._running]

    def run(self, sid: str, trigger: str = "scheduled") -> dict:
        """One sync of one station (blocking: network + SQLite). Updates the schedule."""
        with self._lock:
            if sid in self._running:
                return {"status": "busy", "station_id": sid, "message": "A sync of this station is already running."}
            self._running.add(sid)
        try:
            try:
                result = ingest_live_station(sid)
            except Exception as exc:          # never let one bad page stop the loop
                log.exception("[%s] NCPOR sync crashed", sid)
                result = {"status": "failed", "error": f"internal error: {exc}", "station_id": sid}
            ok = result.get("status") == "success"
            with self._lock:
                self._failures[sid] = 0 if ok else self._failures[sid] + 1
                if self.enabled:
                    self._next[sid] = now_ms() + int(self.delay_after(self._failures[sid]) * 1000)
            if ok:
                log.info("[%s] NCPOR %s sync: %s readings, %s suspect", sid, trigger,
                         result.get("records_ingested"), result.get("suspect", 0))
            else:
                log.warning("[%s] NCPOR %s sync failed (%s); next try in %.0f min", sid, trigger,
                            result.get("error"), self.delay_after(self._failures[sid]) / 60)
            return {**result, "trigger": trigger}
        finally:
            with self._lock:
                self._running.discard(sid)

    def status(self) -> dict:
        """Freshness per station for the UI."""
        out = {}
        with db.connect() as conn:
            for sid in self.stations:
                last = conn.execute("SELECT * FROM ingestion_logs WHERE station_id = ? "
                                    "ORDER BY timestamp DESC, id DESC LIMIT 1", (sid,)).fetchone()
                good = conn.execute("SELECT * FROM ingestion_logs WHERE station_id = ? AND status = 'success' "
                                    "ORDER BY timestamp DESC, id DESC LIMIT 1", (sid,)).fetchone()
                failing_since = None
                if last is not None and last["status"] != "success":
                    row = conn.execute("SELECT MIN(timestamp) FROM ingestion_logs WHERE station_id = ? AND "
                                       "status != 'success' AND timestamp > ?",
                                       (sid, good["timestamp"] if good else 0)).fetchone()
                    failing_since = row[0]
                obs = conn.execute(
                    "SELECT MAX(timestamp) AS newest, COUNT(*) AS n, SUM(quality = 'suspect') AS suspect "
                    "FROM observations WHERE station_id = ? AND dataset = ?", (sid, NCPOR_DATASET)).fetchone()
                with self._lock:
                    nxt, failures, running = self._next[sid], self._failures[sid], sid in self._running
                out[sid] = {
                    "lastAttempt": last["timestamp"] if last else None,
                    "lastStatus": last["status"] if last else None,
                    "lastMessage": last["message"] if last else None,
                    "lastSuccess": good["timestamp"] if good else None,
                    "lastReadings": good["records_ingested"] if good else None,
                    "failingSince": failing_since,
                    "consecutiveFailures": failures,
                    "nextSync": nxt if self.enabled else None,
                    "running": running,
                    "newestObservation": obs["newest"],
                    "storedReadings": obs["n"],
                    "suspectReadings": obs["suspect"] or 0,
                }
        return {
            "enabled": self.enabled, "intervalMin": self.interval_s / 60, "maxBackoffMin": self.max_backoff_s / 60,
            "stations": out,
            "windUnitNote": ("Wind speed is stored in m/s as labelled on the NCPOR page's chart axis; NCPOR does "
                             "not document the unit elsewhere, so it is not independently confirmed."),
            "suspectRule": ("A reading outside a physical range for an Antarctic weather station, or one that "
                            "changes faster than is believable since the last good reading, is stored as "
                            "'suspect' and left out of charts, analysis and the live weather."),
        }
