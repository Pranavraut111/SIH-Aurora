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
  get,
  query,
  orderByChild,
  limitToLast,
  onValue,
  serverTimestamp
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

// ── Query Historical Data ───────────────────────────────────
export async function getRecentSnapshots(stationId, count = 50) {
  if (!firebaseEnabled) return [];
  try {
    const snapshotsRef = query(
      ref(db, `sensor_snapshots/${stationId}`),
      orderByChild('clientTimestamp'),
      limitToLast(Math.min(count, 100))
    );
    const snap = await get(snapshotsRef);
    if (!snap.exists()) return [];
    
    const data = [];
    snap.forEach((child) => {
      data.push({ id: child.key, ...child.val() });
    });
    return data.reverse();
  } catch (err) {
    console.warn('[Firebase] Failed to fetch snapshots:', err.message);
    return [];
  }
}

export async function getRecentAlerts(stationId, count = 30) {
  if (!firebaseEnabled) return [];
  try {
    const alertsRef = query(
      ref(db, `alert_history/${stationId}`),
      orderByChild('clientTimestamp'),
      limitToLast(count)
    );
    const snap = await get(alertsRef);
    if (!snap.exists()) return [];
    
    const data = [];
    snap.forEach((child) => {
      data.push({ id: child.key, ...child.val() });
    });
    return data.reverse();
  } catch (err) {
    console.warn('[Firebase] Failed to fetch alerts:', err.message);
    return [];
  }
}

// ── Station Config ──────────────────────────────────────────
export async function saveStationConfig(stationId, config) {
  if (!firebaseEnabled) return false;
  try {
    const configRef = ref(db, `station_config/${stationId}`);
    await set(configRef, { ...config, updatedAt: serverTimestamp() });
    return true;
  } catch (err) {
    console.warn('[Firebase] Failed to save config:', err.message);
    return false;
  }
}

export function subscribeStationConfig(stationId, callback) {
  if (!firebaseEnabled) return () => {};
  const configRef = ref(db, `station_config/${stationId}`);
  const unsubscribe = onValue(configRef, (snap) => {
    if (snap.exists()) callback(snap.val());
  }, (err) => {
    console.warn('[Firebase] Config subscription error:', err.message);
  });
  
  return unsubscribe; // Call to detach listener
}

// ── Daily Summary ───────────────────────────────────────────
export async function writeDailySummary(stationId, summary) {
  if (!firebaseEnabled) return false;
  const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  try {
    const summaryRef = ref(db, `daily_summaries/${stationId}/${dateStr}`);
    await set(summaryRef, {
      ...summary,
      date: dateStr,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn('[Firebase] Failed to write daily summary:', err.message);
    return false;
  }
}
