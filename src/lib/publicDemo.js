/* Aurora — public demo scenarios (judge mode): names and countdowns for the banner,
   Demo Control and stories. The backend publishes, in every telemetry snapshot,
   `publicDemo: {stationId: {scenario, name, startedBy, startedAt, endsAt, remainingS}}`.
   Countdowns use `remainingS` at the moment the snapshot arrived (`receivedAt`), so a
   visitor's clock being wrong does not matter. */

const LABELS = {
  generator_failure: 'Generator failure',
  heating_failure: 'Heating failure',
  blizzard: 'Blizzard',
  water_crisis: 'Water system alert',
  co2_spike: 'CO₂ spike',
};

/** "Generator failure" for a running record (or a scenario id). */
export function scenarioLabel(recOrId) {
  const id = typeof recOrId === 'string' ? recOrId : recOrId?.scenario;
  return LABELS[id] || (typeof recOrId === 'object' && recOrId?.name) || String(id || '').replace(/_/g, ' ');
}

/** Seconds left for a running record, counting down from when its snapshot arrived. */
export function demoRemainingS(rec, receivedAt, now) {
  if (!rec) return 0;
  const base = Number.isFinite(rec.remainingS) ? rec.remainingS : Math.max(0, (rec.endsAt - (receivedAt || now)) / 1000);
  const elapsed = receivedAt ? Math.max(0, (now - receivedAt) / 1000) : 0;
  return Math.max(0, Math.round(base - elapsed));
}

/** 102 → "1:42". */
export function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Running records as a list, the active station first. */
export function runningDemos(publicDemo, activeStation) {
  const list = Object.values(publicDemo || {}).filter(Boolean);
  return list.sort((a, b) => (a.stationId === activeStation ? -1 : b.stationId === activeStation ? 1 : 0));
}
