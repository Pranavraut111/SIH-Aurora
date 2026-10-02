/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — data → scene mappings (pure, unit-tested).
     alert level      → status token colour (v2 tokens, never new colours)
     device + motion  → quality tier
     wind speed       → blowing-snow intensity
     sun elevation    → light, sky and exposure
   ═══════════════════════════════════════════════════════════════ */
import { status } from '../theme/tokens';

export const LEVELS = ['normal', 'warning', 'critical'];

/** Alert level of a subsystem; anything unknown is 'normal'. */
export function levelOf(alertStates, id) {
  const l = alertStates?.[id];
  return l === 'warning' || l === 'critical' ? l : 'normal';
}

/** The scene is dark in both colour schemes (ui-redesign decision 6), so it uses the dark set. */
export const STATUS_HEX = {
  normal: status.dark.normal.main,
  warning: status.dark.warning.main,
  critical: status.dark.critical.main,
};
export const ACCENT_HEX = '#7FB2E5';     // tokens: accent (dark) — interaction only
export const NEUTRAL_HEX = '#AAB2BD';    // tokens: text.secondary (dark)

/**
 * Quality tier. 'low' on phones and small-memory devices: DPR 1, a smaller shadow map,
 * fewer particles, and a crossfade instead of the fly-over.
 */
export function detectTier({ coarsePointer = false, minScreen = 1080, deviceMemory, cores } = {}) {
  if (coarsePointer && minScreen <= 820) return 'low';
  if (typeof deviceMemory === 'number' && deviceMemory <= 2) return 'low';
  if (typeof cores === 'number' && cores <= 2) return 'low';
  return 'high';
}

export const TIER = {
  high: { dpr: 2, shadow: 2048, snow: 2600, drift: 5200, terrainSeg: 288 },
  low: { dpr: 1, shadow: 1024, snow: 700, drift: 1500, terrainSeg: 160 },
};

/**
 * Blowing-snow intensity in [0, 1] from wind speed (km/h): none below 15, a faint
 * drift at 15–30, a full ground drift towards 55, and low-visibility drift above.
 */
export function driftIntensity(windKmh) {
  if (!Number.isFinite(windKmh) || windKmh < 15) return 0;
  if (windKmh >= 70) return 1;
  return Math.min(1, ((windKmh - 15) / 55) ** 1.3);
}

/** Visibility (fog far distance, metres) from drift intensity: about 2.4 km calm, ≈ 350 m in a blizzard. */
export function visibilityMetres(intensity) {
  return 2400 - 2050 * Math.min(1, Math.max(0, intensity)) ** 1.5;
}

/** Exponential smoothing toward `target` with time constant `tau` seconds. */
export function smoothToward(current, target, dt, tau = 8) {
  if (!Number.isFinite(current)) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** Day state from the sun's elevation (degrees): day, twilight (civil + nautical) or night. */
export function phaseOf(elevationDeg) {
  if (elevationDeg >= 0) return 'day';
  if (elevationDeg >= -12) return 'twilight';
  return 'night';
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const mixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16); const pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(lerp((pa >> sh) & 255, (pb >> sh) & 255, clamp01(t)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};

/**
 * Lighting and sky parameters from the sun's elevation. Restrained: no lens flare,
 * no bloom — only the light's direction, colour and strength, and the sky gradient.
 */
export function atmosphere(elevationDeg) {
  const e = elevationDeg;
  const day = clamp01(e / 25);               // 0 at the horizon, 1 from 25° up
  const dusk = clamp01((e + 12) / 12);       // 0 at −12° (end of nautical twilight), 1 at the horizon
  const low = 1 - clamp01((e - 2) / 14);     // warmth of a low sun
  return {
    sunIntensity: e <= -1 ? 0 : lerp(0.35, 2.4, clamp01((e + 1) / 20)),
    sunColor: mixHex('#FFF4E6', '#FFC995', low),
    hemiIntensity: lerp(0.3, 0.42, dusk) + 0.3 * day,
    hemiSky: mixHex('#4A5D80', '#BBD0E8', Math.max(day, dusk * 0.55)),
    hemiGround: mixHex('#0E1116', '#3A4048', dusk),
    zenith: mixHex(mixHex('#070B13', '#1B2A44', dusk), '#4C79AE', day),
    horizon: mixHex(mixHex('#121A28', '#6B7F9C', dusk), '#D9E2EA', day),
    glow: mixHex('#000000', '#E8A577', dusk * low * (e < 8 ? 1 : 0.4)),
    exposure: lerp(1.5, 0.9, Math.max(day, dusk * 0.4)),
  };
}
