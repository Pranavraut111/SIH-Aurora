/* Aurora — sensor status and threshold wording, shared by every page.
   Status comes only from the backend alert engine (activeAlerts); the text
   describes the station_config.json default thresholds. */
import { formatNumber, formatValue } from './format';

/** Highest active alert level for one sensor, from the backend alert engine. */
export function sensorStatus(activeAlerts, sensor) {
  const levels = activeAlerts.filter((a) => a.sensor === sensor).map((a) => a.level);
  return levels.includes('critical') ? 'critical' : levels.includes('warning') ? 'warning' : undefined;
}

export function thresholdText(catalog, sensor) {
  const c = catalog[sensor];
  if (!c) return null;
  const lo = c.low?.warning;
  const hi = c.high?.warning;
  if (lo != null && hi != null) return `Normal band ${formatNumber(lo)}–${formatValue(hi, c.unit)}`;
  if (hi != null) return `Warning above ${formatValue(hi, c.unit)}`;
  if (lo != null) return `Warning below ${formatValue(lo, c.unit)}`;
  return null;
}
