/* ═══════════════════════════════════════════════════════════════
   Aurora — Analytics Service
   Wraps Firebase Analytics for Aurora-specific event tracking.
   All events are fire-and-forget (no blocking UI).
   ═══════════════════════════════════════════════════════════════ */
import { getFirebaseAnalytics } from '../firebase';
import { logEvent as fbLogEvent } from 'firebase/analytics';

// No-op when Firebase/Analytics is not configured.
function logEvent(name, params) {
  const analytics = getFirebaseAnalytics();
  if (!analytics) return;
  fbLogEvent(analytics, name, params);
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
 * Track alert interaction (click, acknowledge).
 */
export function trackAlertAction(action, buildingId, severity) {
  try {
    logEvent('alert_action', {
      action, // 'click' | 'acknowledge'
      building: buildingId,
      severity,
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
 * Track demo scenario activation.
 */
export function trackDemoScenario(scenarioId) {
  try {
    logEvent('demo_scenario', {
      scenario: scenarioId,
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
