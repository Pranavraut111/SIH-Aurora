"""
Aurora — nightly reset for unattended judging (judge mode).

Run every night at 03:00 IST by cron on the server (deploy/azure/nightly-reset.sh runs it
inside the backend container). It puts the shared station back in a known-good state, so
whatever the day's visitors did, the next judge finds a clean demo:

  1. ends any demo scenario still running (simulator reset, both stations);
  2. deletes expired visitor-sandbox sessions (live ones are left alone);
  3. restores the shared alert-threshold overrides to the baseline;
  4. restores the shared logistics ledger to the baseline (audited as "nightly reset");
  5. writes one log line with what it did.

The baseline (judge_baseline.json) was recorded from the verified live deployment; edit it
(or re-record it) when the intended demo state changes. Exit status 1 if a step failed.
"""

import json
import logging
import sys
import time
from pathlib import Path

import requests
from judge_mode import SANDBOX

import config as app_config
import db

log = logging.getLogger("aurora.nightly_reset")

BASELINE_PATH = Path(__file__).resolve().parent / "judge_baseline.json"
STATIONS = ("maitri", "bharati")
BY = "nightly reset"


def load_baseline(path: Path = BASELINE_PATH) -> dict:
    data = json.loads(path.read_text())
    if not isinstance(data.get("ledger"), dict) or not isinstance(data.get("thresholdOverrides"), list):
        raise ValueError(f"{path}: needs 'ledger' (object) and 'thresholdOverrides' (list)")
    return data


def restore_thresholds(baseline: dict) -> int:
    """Shared overrides := the baseline's. Returns the number of override rows written."""
    now = int(time.time() * 1000)
    rows = [(o["stationId"], o["sensor"], o["direction"], o["level"], float(o["value"]), now, BY)
            for o in baseline["thresholdOverrides"]]
    with db.connect() as conn:
        conn.execute("DELETE FROM alert_threshold_overrides")
        conn.executemany(
            "INSERT INTO alert_threshold_overrides "
            "(station_id, sensor, direction, level, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    return len(rows)


def restore_ledger(baseline: dict) -> int:
    """Ledger items back to the baseline values; every change is audited. Returns items changed."""
    now = int(time.time() * 1000)
    changed = 0
    with db.connect() as conn:
        for item_id, want in baseline["ledger"].items():
            row = conn.execute("SELECT * FROM logistics_inventory WHERE id = ?", (item_id,)).fetchone()
            if row is None:
                log.warning("Nightly reset: baseline item %s is not in the ledger; skipped", item_id)
                continue
            diffs = [(f, row[col], want[key]) for f, col, key in
                     (("current", "current", "current"), ("daily_consumption", "daily_consumption", "dailyConsumption"))
                     if float(row[col]) != float(want[key])]
            if not diffs:
                continue
            changed += 1
            conn.execute("UPDATE logistics_inventory SET current = ?, daily_consumption = ?, last_updated = ?, "
                         "updated_by = ? WHERE id = ?",
                         (want["current"], want["dailyConsumption"], now, BY, item_id))
            conn.executemany(
                "INSERT INTO logistics_audit "
                "(station_id, item_id, field, old_value, new_value, updated_by, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(row["station_id"], item_id, f, str(old), str(new), BY, now) for f, old, new in diffs])
    return changed


def reset_simulator(stations=STATIONS) -> list[str]:
    """End any running scenario. Returns the stations that could not be reset."""
    failed = []
    for sid in stations:
        try:
            r = requests.post(f"{app_config.SIMULATOR_URL}/reset",
                              params={"station": sid, "source": "nightly"}, timeout=10)
            r.raise_for_status()
        except requests.RequestException as exc:
            log.error("Nightly reset: simulator reset failed for %s: %s", sid, exc)
            failed.append(sid)
    return failed


def run() -> dict:
    """Run every step (the backend has already created the schema and run the migrations)."""
    summary = {"ok": True}
    summary["simulatorResetFailed"] = reset_simulator()
    summary["sandboxSessionsRemoved"] = SANDBOX.cleanup()
    baseline = load_baseline()
    summary["thresholdOverrides"] = restore_thresholds(baseline)
    summary["ledgerItemsRestored"] = restore_ledger(baseline)
    summary["ok"] = not summary["simulatorResetFailed"]
    log.warning("Nightly reset %s: %s", "done" if summary["ok"] else "PARTIAL", json.dumps(summary))
    return summary


if __name__ == "__main__":
    result = run()
    print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **result}))
    sys.exit(0 if result["ok"] else 1)
