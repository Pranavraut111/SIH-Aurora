/* ═══════════════════════════════════════════════════════════════
   Aurora — sun position for the station mini-card (polar day / night).
   Computed, not invented: the low-precision solar coordinates of the
   Astronomical Almanac (≈0.01° in declination, ample for "is the sun up"),
   evaluated for the station's latitude/longitude from station_config.json.
   Elevation is geometric (no refraction), so sunrise/sunset can differ from
   an almanac's by a few minutes. Labelled MODEL-DERIVED in the UI.
   ═══════════════════════════════════════════════════════════════ */

const RAD = Math.PI / 180;
const MIN = 60_000;
const DAY = 86_400_000;

/** Solar elevation in degrees at `ms` (epoch ms) for a latitude/longitude in degrees. */
export function solarElevation(ms, lat, lon) {
  const n = ms / DAY + 2440587.5 - 2451545.0;            // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24) * 15 * RAD;
  const ha = gmst + lon * RAD - ra;
  const phi = lat * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)) / RAD;
}

/** Local mean solar time (from longitude alone) as a Date-like UTC offset in ms. */
export function solarTimeOffsetMs(lon) {
  return (lon / 15) * 3_600_000;
}

/**
 * Day/night state around `now`:
 *  polar-night  sun below the horizon for the whole next 24 h
 *  polar-day    sun above the horizon for the whole next 24 h (midnight sun)
 *  day / night  with the next sunset / sunrise
 * plus a 24-h elevation curve centred on now (for the sun-path line).
 */
export function dayState(now, lat, lon, stepMin = 5) {
  const step = stepMin * MIN;
  const elevNow = solarElevation(now, lat, lon);
  let next = null;
  let prevE = elevNow;
  let lo = elevNow;
  let hi = elevNow;
  for (let t = now + step; t <= now + DAY; t += step) {
    const e = solarElevation(t, lat, lon);
    if (e < lo) lo = e;
    if (e > hi) hi = e;
    if (!next && Math.sign(e) !== Math.sign(prevE)) {
      // linear interpolation of the crossing between the two samples
      next = new Date(t - step + (step * prevE) / (prevE - e));
    }
    prevE = e;
  }
  const curve = [];
  for (let t = now - DAY / 2; t <= now + DAY / 2; t += 20 * MIN) curve.push([t, solarElevation(t, lat, lon)]);
  const state = hi < 0 ? 'polar-night' : lo > 0 ? 'polar-day' : elevNow > 0 ? 'day' : 'night';
  return { state, elevation: elevNow, min: lo, max: hi, next: state === 'day' || state === 'night' ? next : null, curve };
}
