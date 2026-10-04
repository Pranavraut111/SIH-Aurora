/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — heat map scoring (pure, no three.js).

   Each sensor gets a 0–1 "heat" from two real signals:
     · threshold proximity — where the reading sits relative to its
       warning/critical limits in station_config.json (rule-based):
       0 well inside the band, 0.6 at the warning limit, 1 at critical;
     · model residual — |observed − physics prediction| in σ from
       /ai/anomaly, scaled so the residual alarm gate (6σ) = 1.
   A building's heat is the hottest of its sensors. Neither number is a
   probability of failure, and the UI says so.
   ═══════════════════════════════════════════════════════════════ */

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** One side of a threshold band: 0 at the comfortable point, 0.6 at warning, 1 at critical. */
function sideHeat(value, warning, critical, dir) {
  if (!isNum(warning) && !isNum(critical)) return 0;
  const w = isNum(warning) ? warning : critical;
  const c = isNum(critical) ? critical : warning;
  const gap = Math.abs(c - w) || Math.abs(w) * 0.1 || 1;
  const d = dir === 'high' ? value - w : w - value;   // > 0 past the warning limit
  if (d >= 0) return clamp01(0.6 + 0.4 * (d / gap));
  return clamp01(0.6 + 0.6 * (d / (2 * gap)));        // 0 at two gaps inside warning
}

/** Threshold proximity of one reading, 0–1 (null when there is no reading). */
export function thresholdHeat(value, sensor) {
  if (!isNum(value) || !sensor) return null;
  const hi = sensor.high ? sideHeat(value, sensor.high.warning, sensor.high.critical, 'high') : 0;
  const lo = sensor.low ? sideHeat(value, sensor.low.warning, sensor.low.critical, 'low') : 0;
  return Math.max(hi, lo);
}

/** Physics-model residual of one sensor, 0–1. */
export function residualHeat(z, alarmSigma = 6) {
  if (!isNum(z)) return null;
  return clamp01(Math.abs(z) / (alarmSigma || 6));
}

/**
 * Per-sensor and per-building heat.
 * @param sensors   telemetry snapshot {building: {sensorId: value}}
 * @param catalog   sensorCatalog(station) {sensorId: {building, low?, high?, …}}
 * @param anomaly   /ai/anomaly response (optional)
 * @returns {{ sensors: {id: {threshold, residual, z, expected, heat, building}}, buildings: {id: {heat, hottest, source}} }}
 */
export function computeHeat(sensors = {}, catalog = {}, anomaly = null) {
  const residuals = Object.fromEntries((anomaly?.residuals || []).map((r) => [r.sensor, r]));
  const gate = anomaly?.residualAlarmSigma || 6;
  const out = { sensors: {}, buildings: {} };
  Object.entries(catalog).forEach(([id, c]) => {
    const value = sensors?.[c.building]?.[id];
    const r = residuals[id];
    const threshold = thresholdHeat(value, c);
    const residual = residualHeat(r?.z, gate);
    const heat = Math.max(threshold ?? 0, residual ?? 0);
    out.sensors[id] = { building: c.building, value, threshold, residual, z: r?.z ?? null, expected: r?.expected ?? null, heat };
    const b = out.buildings[c.building] || { heat: 0, hottest: null, source: null };
    if (heat >= b.heat) {
      b.heat = heat; b.hottest = id;
      b.source = (residual ?? 0) > (threshold ?? 0) ? 'residual' : 'threshold';
    }
    out.buildings[c.building] = b;
  });
  return out;
}

/** Thermal ramp: cool blue → green → amber → orange → red. */
const RAMP = [
  [0, [0x3b, 0x82, 0xf6]],
  [0.3, [0x22, 0xc5, 0x5e]],
  [0.6, [0xfa, 0xcc, 0x15]],
  [0.8, [0xf9, 0x73, 0x16]],
  [1, [0xef, 0x44, 0x44]],
];

export function heatRgb(t) {
  const x = clamp01(isNum(t) ? t : 0);
  for (let i = 1; i < RAMP.length; i += 1) {
    const [t1, c1] = RAMP[i];
    const [t0, c0] = RAMP[i - 1];
    if (x <= t1) {
      const u = (x - t0) / (t1 - t0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * u));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export function heatHex(t) {
  const [r, g, b] = heatRgb(t);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export const HEAT_STOPS = RAMP.map(([t]) => t);
