/* ═══════════════════════════════════════════════════════════════
   Aurora — Firebase Realtime Database Service
   Handles all database operations using the free Spark plan RTDB.
   - Sensor snapshots (throttled writes every 30s)
   - Alert history log
   - Station configuration persistence
   ═══════════════════════════════════════════════════════════════ */
import { db, firebaseEnabled } from '../firebase';
import {
  ref,
  push,
  set,
  serverTimestamp,
} from 'firebase/database';

// ── Sensor Snapshot Writes ───────────────────────────────────
const WRITE_INTERVAL_MS = 30_000; // 30 seconds
let lastWriteTime = 0;

export async function writeSensorSnapshot(stationId, sensors, alerts) {
  if (!firebaseEnabled) return false;
  const now = Date.now();
  if (now - lastWriteTime < WRITE_INTERVAL_MS) return false;
  lastWriteTime = now;

  try {
    const snapshotsRef = ref(db, `sensor_snapshots/${stationId}`);
    const newSnapshotRef = push(snapshotsRef);
    await set(newSnapshotRef, {
      sensors,
      alerts,
      serverTime: serverTimestamp(),
      clientTimestamp: now,
    });
    return true;
  } catch (err) {
    console.warn('[Firebase] Failed to write sensor snapshot:', err.message);
    return false;
  }
}

// ── Alert History ────────────────────────────────────────────
const alertCache = new Map(); // buildingId → last severity logged

export async function logAlert(stationId, buildingId, severity, buildingName, triggeredSensors = []) {
  if (!firebaseEnabled) return;
  const cacheKey = `${stationId}:${buildingId}`;
  if (alertCache.get(cacheKey) === severity) return; // Already logged
  alertCache.set(cacheKey, severity);

  try {
    const alertsRef = ref(db, `alert_history/${stationId}`);
    const newAlertRef = push(alertsRef);
    await set(newAlertRef, {
      buildingId,
      buildingName,
      severity,
      triggeredSensors,
      timestamp: serverTimestamp(),
      clientTimestamp: Date.now(),
      acknowledged: false,
    });
  } catch (err) {
    console.warn('[Firebase] Failed to log alert:', err.message);
  }
}

export function clearAlertCache(stationId, buildingId) {
  alertCache.delete(`${stationId}:${buildingId}`);
}

