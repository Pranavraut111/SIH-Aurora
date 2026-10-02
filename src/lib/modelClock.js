/* ═══════════════════════════════════════════════════════════════
   Aurora — which clock the model's figures live on.

   In reanalysis mode the twin replays ERA5 weather at AURORA_SPEED (120× by
   default): one 2 s tick advances the model by 4 min. Physical quantities
   (heating demand, fuel burn) evolve on that REPLAY clock, so deltas, rolling
   averages and chart axes use it, and say so. When there is no replay clock
   (backend physics fallback, browser demo) the model runs on the wall clock,
   and the windows switch to wall-clock ones, labelled as such.
   ═══════════════════════════════════════════════════════════════ */
import { isNum } from './format';

const MIN = 60_000;
const HOUR = 60 * MIN;

export const CLOCKS = {
  replay: {
    kind: 'replay', suffix: 'replay time',
    deltaMs: HOUR, deltaLabel: 'vs 1 h earlier (replay time)',
    avgMs: 24 * HOUR, maMs: HOUR, sparkBucketMs: HOUR,
  },
  wall: {
    kind: 'wall', suffix: 'wall clock',
    deltaMs: 15 * MIN, deltaLabel: 'vs 15 min earlier (wall clock)',
    avgMs: 15 * MIN, maMs: MIN, sparkBucketMs: MIN,
  },
};

/** 90 000 → "1.5 min"; 3 600 000 → "1 h"; 216 000 000 → "60 h". */
export function formatSpan(ms) {
  if (!isNum(ms)) return '—';
  if (ms >= HOUR) { const h = ms / HOUR; return `${h >= 10 ? Math.round(h) : +h.toFixed(1)} h`; }
  const m = ms / MIN;
  return `${m >= 10 ? Math.round(m) : Math.max(1, +m.toFixed(0))} min`;
}

/**
 * Re-time [[wallTs, value]] points onto the replay clock using the
 * 'replay.timeMs' series (one replay instant per published wall timestamp).
 * Points without a replay instant (fallback ticks) are dropped, and only the
 * newest monotonic stretch is kept: when the 7-day replay loops back to its
 * start, the older loop is not mixed into the axis.
 */
export function retime(points, clockPoints) {
  if (!points?.length || !clockPoints?.length) return [];
  const at = new Map(clockPoints.map(([t, r]) => [t, r]));
  const out = [];
  for (const [t, v] of points) {
    const r = at.get(t);
    if (!isNum(r)) continue;
    if (out.length && r <= out[out.length - 1][0]) out.length = 0;   // replay looped: restart
    out.push([r, v]);
  }
  return out;
}

/** Trailing moving average over `windowMs` of the point's own clock, one value per point. */
export function movingAverage(points, windowMs) {
  const out = [];
  let lo = 0;
  let sum = 0;
  for (let i = 0; i < (points?.length ?? 0); i += 1) {
    sum += points[i][1];
    while (points[lo][0] < points[i][0] - windowMs) { sum -= points[lo][1]; lo += 1; }
    out.push([points[i][0], sum / (i - lo + 1)]);
  }
  return out;
}

/**
 * Pick the clock and put every series on it. `replayMs` is the latest
 * snapshot's replay instant (null when the source has no replay clock).
 */
export function onModelClock(series, keys, replayMs) {
  const clockPts = series['replay.timeMs'];
  if (isNum(replayMs) && clockPts?.length >= 2) {
    const out = Object.fromEntries(keys.map((k) => [k, retime(series[k], clockPts)]));
    if (keys.some((k) => out[k].length >= 2)) return { clock: CLOCKS.replay, series: out };
  }
  return { clock: CLOCKS.wall, series: Object.fromEntries(keys.map((k) => [k, series[k] || []])) };
}
