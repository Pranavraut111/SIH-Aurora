/* ═══════════════════════════════════════════════════════════════
   Aurora — Analytics Service
   Wraps Firebase Analytics for Aurora-specific event tracking.
   All events are fire-and-forget (no blocking UI).
   ═══════════════════════════════════════════════════════════════ */
import { firebaseEnabled, getFirebaseAnalytics } from '../firebase';

// No-op when Firebase/Analytics is not configured. Fire-and-forget: the SDK is
// loaded on demand, so nothing here blocks the UI or runs when Firebase is off.
function logEvent(name, params) {
  if (!firebaseEnabled) return;
  getFirebaseAnalytics()
    .then((fb) => fb && fb.logEvent(fb.analytics, name, params))
    .catch((e) => console.debug('[analytics] event not sent (analytics unavailable)', e));
}

/**
 * Track module navigation (user switches tabs).
 */
export function trackModuleView(moduleId, stationId) {
  try {
    logEvent('module_view', {
      module: moduleId,
      station: stationId,
    });
  } catch (e) { console.debug("[analytics] event not sent (analytics unavailable)", e); }
}

/**
 * Track building detail panel open.
 */
export function trackBuildingView(buildingId, stationId) {
  try {
    logEvent('building_view', {
      building: buildingId,
      station: stationId,
    });
  } catch (e) { console.debug("[analytics] event not sent (analytics unavailable)", e); }
}

/**
 * Track connection toggle events.
 */
export function trackConnectionToggle(newState) {
  try {
    logEvent('connection_toggle', {
      state: newState ? 'connected' : 'disconnected',
    });
  } catch (e) { console.debug("[analytics] event not sent (analytics unavailable)", e); }
}

/**
 * Track station switch.
 */
export function trackStationSwitch(fromStation, toStation) {
  try {
    logEvent('station_switch', {
      from: fromStation,
      to: toStation,
    });
  } catch (e) { console.debug("[analytics] event not sent (analytics unavailable)", e); }
}
