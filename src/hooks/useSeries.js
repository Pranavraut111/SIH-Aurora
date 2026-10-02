/* ═══════════════════════════════════════════════════════════════
   Aurora — useSeries: the last N minutes of a few sensors, for charts,
   sparklines, deltas and rolling averages.

   On mount (and whenever the station, the keys or the telemetry source change)
   it loads the backend's rolling history (GET /api/history: the values that were
   published, one per tick), then appends every new snapshot the page receives,
   so the window is full from the first paint and stays live. With no backend
   (browser demo mode) it starts empty and fills from live snapshots only.

   keys: ['generator.gen_power', …]  →  series: {key: [[timestampMs, value], …]}
   The replay clock ('replay.timeMs') is always loaded alongside, so callers can
   put the series on the model's clock (lib/modelClock).
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';
import { apiGet } from '../services/api';
import { isNum } from '../lib/format';

/** Append one point per key from a snapshot, drop points older than the window. */
export function appendSnapshot(series, keys, sensors, ts, windowMs) {
  if (!isNum(ts)) return series;
  let changed = false;
  const next = { ...series };
  for (const key of keys) {
    const [bld, sensor] = key.split('.');
    const v = sensors?.[bld]?.[sensor];
    const pts = next[key] || [];
    if (!isNum(v) || (pts.length && pts[pts.length - 1][0] >= ts)) continue;
    const cutoff = ts - windowMs;
    let start = 0;
    while (start < pts.length && pts[start][0] < cutoff) start += 1;
    next[key] = [...pts.slice(start), [ts, v]];
    changed = true;
  }
  return changed ? next : series;
}

/** Merge backend history with live points received while it loaded (no duplicates). */
export function mergeSeries(history, live) {
  const out = {};
  for (const key of new Set([...Object.keys(history), ...Object.keys(live)])) {
    const h = (history[key] || []).filter((p) => isNum(p?.[0]) && isNum(p?.[1]));
    const lastT = h.length ? h[h.length - 1][0] : -Infinity;
    out[key] = [...h, ...(live[key] || []).filter(([t]) => t > lastT)];
  }
  return out;
}

/** Value about `agoMs` before the newest point (the nearest sample at or before it). */
export function valueAgo(points, agoMs) {
  if (!points?.length) return null;
  const target = points[points.length - 1][0] - agoMs;
  if (points[0][0] > target) return null;          // window does not reach that far back yet
  for (let i = points.length - 1; i >= 0; i -= 1) if (points[i][0] <= target) return points[i][1];
  return null;
}

/** Mean of the samples in the last `windowMs`, with the span it actually covers. */
export function rollingMean(points, windowMs) {
  if (!points?.length) return { mean: null, spanMs: 0, n: 0 };
  const end = points[points.length - 1][0];
  const inWin = points.filter(([t]) => t >= end - windowMs);
  const mean = inWin.reduce((s, [, v]) => s + v, 0) / inWin.length;
  return { mean, spanMs: end - inWin[0][0], n: inWin.length };
}

export function useSeries({ station, keys, minutes = 30, sensors: rawSensors, timestamp, source, replayMs }) {
  const keyStr = [...keys, 'replay.timeMs'].join(',');
  const sensors = rawSensors && isNum(replayMs) ? { ...rawSensors, replay: { timeMs: replayMs } } : rawSensors;
  const windowMs = minutes * 60_000;
  const id = `${station}|${keyStr}|${minutes}|${source}`;
  const fresh = { id, series: {}, loaded: source === 'browser-demo', error: null, lastTs: null };
  const [state, setState] = useState(fresh);

  // State adjusted during render (no effect round-trip): a new station/keys/source starts
  // an empty window; each new snapshot appends one point per key. Live points gathered
  // before the backend window arrives are kept and merged after it.
  let current = state;
  if (state.id !== id) {
    current = fresh;
    setState(fresh);
  } else if (isNum(timestamp) && timestamp !== state.lastTs && sensors) {
    current = { ...state, lastTs: timestamp, series: appendSnapshot(state.series, keyStr.split(','), sensors, timestamp, windowMs) };
    setState(current);
  }

  // Load the backend window once per id.
  useEffect(() => {
    if (source === 'browser-demo') return undefined;
    let active = true;
    apiGet(`/history?stationId=${encodeURIComponent(station)}&keys=${encodeURIComponent(keyStr)}&minutes=${minutes}`)
      .then((body) => {
        if (active) setState((s) => (s.id === id ? { ...s, series: mergeSeries(body.series || {}, s.series), loaded: true } : s));
      })
      .catch((err) => {
        console.error('[useSeries] history failed', err);
        if (active) setState((s) => (s.id === id ? { ...s, loaded: true, error: err } : s));
      });
    return () => { active = false; };
  }, [id, station, keyStr, minutes, source]);

  return { series: current.series, loaded: current.loaded, error: current.error };
}
