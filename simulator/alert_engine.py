"""
Aurora — persistent threshold alerts (PROJECT_CONTEXT.md B22, §14, §15).

Every telemetry sensor is checked each tick against its effective thresholds:
station_config.json defaults, overridden by operator values saved in SQLite
(alert_threshold_overrides; station-specific rows beat '*' rows).

Lifecycle of an alert (one open alert per station + sensor):
- raised immediately when a sensor crosses its warning/critical threshold
  (row inserted in station_alerts, status 'active');
- escalates to critical immediately; de-escalates critical → warning only
  after RESOLVE_TICKS consecutive ticks at the lower level (no flapping);
- acknowledged by id (who/when recorded; status 'acknowledged'), which
  persists across restarts because open alerts are reloaded from SQLite;
- auto-resolves after RESOLVE_TICKS consecutive normal ticks (hysteresis),
  status 'resolved' with resolved_at.

Thread safety: evaluate() runs in the tick's worker thread and acknowledge()
in a request thread; one lock guards the in-memory state and its DB writes.
"""

import logging
import threading
import time

import db
import station_config

log = logging.getLogger("aurora.alerts")

LEVEL_RANK = {"normal": 0, "warning": 1, "critical": 2}
OPEN_STATUSES = ("active", "acknowledged")


class AlertNotFound(KeyError):
    pass


def classify(value: float, thresholds: dict) -> tuple[str, str | None, float | None]:
    """(level, direction, threshold) for one value. Critical beats warning."""
    for level in ("critical", "warning"):
        low = thresholds.get("low", {}).get(level)
        if low is not None and value <= low:
            return level, "low", low
        high = thresholds.get("high", {}).get(level)
        if high is not None and value >= high:
            return level, "high", high
    return "normal", None, None


# ── threshold overrides (admin) ───────────────────────────────

def load_overrides(station_id: str | None = None) -> list[dict]:
    with db.connect() as conn:
        if station_id is None:
            rows = conn.execute("SELECT * FROM alert_threshold_overrides ORDER BY station_id, sensor").fetchall()
        else:
            rows = conn.execute("SELECT * FROM alert_threshold_overrides WHERE station_id IN (?, '*') "
                                "ORDER BY station_id, sensor", (station_id,)).fetchall()
    return [{"stationId": r["station_id"], "sensor": r["sensor"], "direction": r["direction"], "level": r["level"],
             "value": r["value"], "updatedAt": r["updated_at"], "updatedBy": r["updated_by"]} for r in rows]


def effective_thresholds(station_id: str, overrides: list[dict] | None = None) -> dict:
    """Defaults from station_config.json with '*' then station-specific overrides applied."""
    th = station_config.default_thresholds(station_id)
    ov = load_overrides(station_id) if overrides is None else overrides
    for scope in ("*", station_id):
        for o in ov:
            if o["stationId"] == scope and o["sensor"] in th and o["direction"] in th[o["sensor"]]:
                th[o["sensor"]][o["direction"]][o["level"]] = o["value"]
    return th


def validate_threshold_update(station_id: str, updates: dict[str, dict], base=None) -> list[str]:
    """updates: {sensor: {direction: {level: value}}}. Returns a list of errors (empty = OK).
    station_id may be '*' (all stations): every station is checked. `base(sid)` gives the
    thresholds the update applies to (default: the shared effective thresholds; a visitor
    sandbox passes its own view, so the same rules check the same merged result)."""
    errors = []
    stations = station_config.station_ids() if station_id == "*" else (station_id,)
    for sid in stations:
        sensors = station_config.sensors(sid)
        merged = (base or effective_thresholds)(sid)
        for sensor, dirs in updates.items():
            if sensor not in sensors:
                errors.append(f"unknown sensor '{sensor}'")
                continue
            lo, hi = sensors[sensor]["thresholdRange"]
            unit = sensors[sensor]["unit"]
            for direction, levels in dirs.items():
                if direction not in merged[sensor]:
                    errors.append(f"{sensor} has no '{direction}' threshold (allowed: {', '.join(merged[sensor])})")
                    continue
                for level, value in levels.items():
                    if not (lo <= value <= hi):
                        errors.append(f"{sensor}.{direction}.{level} must be between "
                                      f"{lo} and {hi} {unit} (got {value})")
                    merged[sensor][direction][level] = value
        for sensor, dirs in merged.items():
            if sensor not in updates:
                continue
            for direction, lv in dirs.items():
                w, c = lv.get("warning"), lv.get("critical")
                if direction == "high" and w is not None and c is not None and not w < c:
                    errors.append(f"{sensor}: high warning ({w}) must be lower than high critical ({c})")
                if direction == "low" and w is not None and c is not None and not w > c:
                    errors.append(f"{sensor}: low warning ({w}) must be higher than low critical ({c})")
    return sorted(set(errors))


def save_overrides(station_id: str, updates: dict[str, dict], updated_by: str) -> int:
    now = int(time.time() * 1000)
    rows = [(station_id, sensor, direction, level, float(value), now, updated_by)
            for sensor, dirs in updates.items() for direction, levels in dirs.items()
            for level, value in levels.items()]
    with db.connect() as conn:
        conn.executemany(
            "INSERT INTO alert_threshold_overrides "
            "(station_id, sensor, direction, level, value, updated_at, updated_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(station_id, sensor, direction, level) "
            "DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
            rows)
    return len(rows)


def reset_overrides(station_id: str, sensor: str | None = None) -> int:
    with db.connect() as conn:
        if sensor is None:
            cur = conn.execute("DELETE FROM alert_threshold_overrides WHERE station_id = ?", (station_id,))
        else:
            cur = conn.execute("DELETE FROM alert_threshold_overrides WHERE station_id = ? AND sensor = ?",
                               (station_id, sensor))
    return cur.rowcount


# ── the engine ────────────────────────────────────────────────

class AlertEngine:
    def __init__(self, stations, resolve_ticks: int = 3):
        self.stations = tuple(stations)
        self.resolve_ticks = max(1, int(resolve_ticks))
        self._lock = threading.Lock()
        self._open: dict[str, dict[str, dict]] = {sid: {} for sid in self.stations}

    # Called at startup (and by tests) so acknowledgements survive restarts.
    def load_open(self) -> int:
        with self._lock:
            self._open = {sid: {} for sid in self.stations}
            with db.connect() as conn:
                rows = conn.execute("SELECT * FROM station_alerts WHERE status IN (?, ?)", OPEN_STATUSES).fetchall()
            for r in rows:
                if r["station_id"] in self._open and r["parameter"]:
                    self._open[r["station_id"]][r["parameter"]] = self._state_from_row(r)
            n = sum(len(v) for v in self._open.values())
        log.info("Alert engine loaded %d open alert(s) from SQLite", n)
        return n

    @staticmethod
    def _state_from_row(r) -> dict:
        return {
            "id": r["id"], "building": r["subsystem"], "sensor": r["parameter"], "level": r["severity"],
            "peak": r["peak_severity"] or r["severity"], "direction": r["direction"], "threshold": r["threshold_value"],
            "unit": r["unit"], "value": r["observed_value"], "raisedAt": r["timestamp"], "status": r["status"],
            "acknowledgedBy": r["acknowledged_by"], "acknowledgedAt": r["acknowledged_at"],
            "clearTicks": 0, "lowerTicks": 0, "message": r["reason"],
        }

    def evaluate(self, station_id: str, sensors: dict, ts_ms: int) -> tuple[dict[str, str], list[dict]]:
        """Check every configured sensor; persist raises/escalations/resolutions.
        Returns ({building: level}, [open alert dicts for the UI])."""
        th = effective_thresholds(station_id)
        catalog = station_config.sensors(station_id)
        names = station_config.building_names(station_id)
        with self._lock:
            open_alerts = self._open[station_id]
            with db.connect() as conn:
                for sensor, thresholds in th.items():
                    building = catalog[sensor]["building"]
                    value = sensors.get(building, {}).get(sensor)
                    if value is None:
                        continue
                    level, direction, threshold = classify(float(value), thresholds)
                    current = open_alerts.get(sensor)
                    if level != "normal":
                        if current is None:
                            open_alerts[sensor] = self._raise(conn, station_id, sensor, catalog[sensor], level,
                                                              direction, threshold, value, ts_ms)
                        else:
                            self._update(conn, current, catalog[sensor], level, direction, threshold, value, ts_ms)
                    elif current is not None:
                        current["value"] = value
                        current["clearTicks"] += 1
                        if current["clearTicks"] >= self.resolve_ticks:
                            self._resolve(conn, station_id, current, value, ts_ms)
                            del open_alerts[sensor]
            levels = {b: "normal" for b in names}
            active = []
            for a in sorted(open_alerts.values(), key=lambda x: (-LEVEL_RANK[x["level"]], x["raisedAt"])):
                if LEVEL_RANK[a["level"]] > LEVEL_RANK[levels.get(a["building"], "normal")]:
                    levels[a["building"]] = a["level"]
                active.append(self._public(a, names))
        return levels, active

    # ── lifecycle steps (lock held) ──
    def _raise(self, conn, sid, sensor, meta, level, direction, threshold, value, ts_ms) -> dict:
        alert_id = f"ALT-{sid}-{sensor}-{ts_ms}"
        msg = _message(meta, level, direction, threshold, value)
        conn.execute(
            "INSERT INTO station_alerts (id, station_id, timestamp, severity, subsystem, parameter, observed_value, "
            "threshold_or_model, reason, recommended_action, status, threshold_value, direction, unit, "
            "peak_severity, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (alert_id, sid, ts_ms, level, meta["building"], sensor, float(value),
             f"{direction} {level} threshold {threshold} {meta['unit']} (station_config/admin)",
             msg, None, "active", threshold, direction, meta["unit"], level, ts_ms))
        log.info("[%s] alert raised %s: %s", sid, alert_id, msg)
        return {"id": alert_id, "building": meta["building"], "sensor": sensor, "level": level, "peak": level,
                "direction": direction, "threshold": threshold, "unit": meta["unit"], "value": value,
                "raisedAt": ts_ms, "status": "active", "acknowledgedBy": None, "acknowledgedAt": None,
                "clearTicks": 0, "lowerTicks": 0, "message": msg}

    def _update(self, conn, a, meta, level, direction, threshold, value, ts_ms):
        a["value"] = value
        a["clearTicks"] = 0
        new_level = a["level"]
        if LEVEL_RANK[level] > LEVEL_RANK[a["level"]]:
            new_level, a["lowerTicks"] = level, 0                      # escalate immediately
        elif LEVEL_RANK[level] < LEVEL_RANK[a["level"]]:
            a["lowerTicks"] += 1                                       # de-escalate only after N ticks
            if a["lowerTicks"] >= self.resolve_ticks:
                new_level, a["lowerTicks"] = level, 0
        else:
            a["lowerTicks"] = 0
        if new_level != a["level"] or direction != a["direction"]:
            a.update(level=new_level, direction=direction, threshold=threshold,
                     message=_message(meta, new_level, direction, threshold, value))
            if LEVEL_RANK[new_level] > LEVEL_RANK[a["peak"]]:
                a["peak"] = new_level
            conn.execute(
                "UPDATE station_alerts SET severity = ?, peak_severity = ?, direction = ?, threshold_value = ?, "
                "observed_value = ?, reason = ?, updated_at = ? WHERE id = ?",
                (new_level, a["peak"], direction, threshold, float(value), a["message"], ts_ms, a["id"]))

    def _resolve(self, conn, sid, a, value, ts_ms):
        conn.execute(
            "UPDATE station_alerts SET status = 'resolved', resolved_at = ?, observed_value = ?, updated_at = ? "
            "WHERE id = ?", (ts_ms, float(value), ts_ms, a["id"]))
        log.info("[%s] alert resolved %s after %d normal ticks", sid, a["id"], self.resolve_ticks)

    @staticmethod
    def _public(a, names) -> dict:
        return {
            "id": a["id"], "buildingId": a["building"], "buildingName": names.get(a["building"], a["building"]),
            "level": a["level"], "peakLevel": a["peak"], "sensor": a["sensor"], "value": a["value"],
            "unit": a["unit"], "threshold": a["threshold"], "direction": a["direction"], "message": a["message"],
            "timestamp": a["raisedAt"], "status": a["status"], "acknowledged": a["status"] == "acknowledged",
            "acknowledgedBy": a["acknowledgedBy"], "acknowledgedAt": a["acknowledgedAt"],
            "clearing": a["clearTicks"] > 0,
            "triggeredSensors": [{"name": a["sensor"], "value": a["value"], "unit": a["unit"]}],
        }

    # ── acknowledge ──
    def acknowledge(self, alert_id: str, by: str) -> dict:
        now = int(time.time() * 1000)
        with self._lock:
            with db.connect() as conn:
                row = conn.execute("SELECT * FROM station_alerts WHERE id = ?", (alert_id,)).fetchone()
                if row is None:
                    raise AlertNotFound(alert_id)
                if row["acknowledged_at"] is not None:
                    return {**dict(row), "alreadyAcknowledged": True}
                new_status = "resolved" if row["status"] == "resolved" else "acknowledged"
                conn.execute("UPDATE station_alerts SET status = ?, acknowledged_by = ?, acknowledged_at = ?, "
                             "updated_at = ? WHERE id = ?", (new_status, by, now, now, alert_id))
                row = conn.execute("SELECT * FROM station_alerts WHERE id = ?", (alert_id,)).fetchone()
            st = self._open.get(row["station_id"], {}).get(row["parameter"])
            if st is not None and st["id"] == alert_id:
                st.update(status=new_status, acknowledgedBy=by, acknowledgedAt=now)
        log.info("Alert %s acknowledged by %s", alert_id, by)
        return {**dict(row), "alreadyAcknowledged": False}

    @staticmethod
    def history(station_id: str, limit: int = 100) -> list[dict]:
        with db.connect() as conn:
            rows = conn.execute("SELECT * FROM station_alerts WHERE station_id = ? ORDER BY timestamp DESC, id DESC "
                                "LIMIT ?", (station_id, limit)).fetchall()
        return [dict(r) for r in rows]


def _message(meta: dict, level: str, direction: str, threshold: float, value: float) -> str:
    rel = "below" if direction == "low" else "above"
    return (f"{meta['name']} {round(float(value), 2)} {meta['unit']} is {rel} the {level} threshold "
            f"({threshold} {meta['unit']}).")
