/* ═══════════════════════════════════════════════════════════════
   Aurora — useDatabase Hook
   Bridges the live data stream to Firebase Realtime Database persistence.
   - Auto-persists sensor snapshots (throttled to 30s)
   - Auto-logs alerts (deduped by building+severity)
   (Firebase is disabled by default — see CLAUDE.md; these calls are no-ops then.)
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useRef } from 'react';
import {
  writeSensorSnapshot,
  logAlert,
  clearAlertCache,
} from '../services/databaseService';

export function useDatabase(stationId, stationData, enabled = true) {
  const prevAlerts = useRef({});

  // ── Auto-persist sensor snapshots ─────────────────────────
  useEffect(() => {
    if (!enabled || !stationData?.sensors) return;
    writeSensorSnapshot(stationId, stationData.sensors, stationData.alerts);
  }, [stationId, stationData?.timestamp, enabled]);

  // ── Auto-log alert changes ────────────────────────────────
  useEffect(() => {
    if (!enabled || !stationData?.alerts) return;

    const currentAlerts = stationData.alerts;
    const prev = prevAlerts.current;

    Object.entries(currentAlerts).forEach(([buildingId, severity]) => {
      const prevSeverity = prev[buildingId];

      if (severity !== 'normal' && severity !== prevSeverity) {
        const activeAlert = stationData.activeAlerts?.find(a => a.buildingId === buildingId);
        logAlert(
          stationId,
          buildingId,
          severity,
          activeAlert?.buildingName || buildingId,
          activeAlert?.triggeredSensors || [],
        );
      } else if (severity === 'normal' && prevSeverity && prevSeverity !== 'normal') {
        clearAlertCache(stationId, buildingId);
      }
    });

    prevAlerts.current = { ...currentAlerts };
  }, [stationId, stationData?.alerts, enabled]);
}
