/* Aurora — geometry for ui/Sparkline (kept apart so the component file only exports components). */
import { isNum } from '../lib/format';

export const SPARK_W = 100;   // viewBox width; the SVG stretches to its container
const W = SPARK_W;

/** Mean of each `bucketMs` slice (timestamped at the slice's last sample): a trend line
 *  without per-tick noise. */
export function bucketMeans(points, bucketMs) {
  const out = [];
  let key = null;
  let sum = 0;
  let n = 0;
  let t = 0;
  for (const [ts, v] of points) {
    const k = Math.floor(ts / bucketMs);
    if (k !== key && n) { out.push([t, sum / n]); sum = 0; n = 0; }
    key = k; sum += v; n += 1; t = ts;
  }
  if (n) out.push([t, sum / n]);
  return out;
}

export function sparkPath(points, height, pad = 2, bucketMs = 60_000) {
  let pts = (points || []).filter((p) => isNum(p?.[0]) && isNum(p?.[1]));
  // Bucket only when that still leaves a line (short windows keep their raw samples).
  if (bucketMs && pts.length > 1 && pts[pts.length - 1][0] - pts[0][0] >= 3 * bucketMs) pts = bucketMeans(pts, bucketMs);
  if (pts.length < 2) return null;
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, v] of pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
  // A flat series sits mid-height instead of on the floor.
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const x = (t) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad);
  const line = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(2)} ${y(v).toFixed(2)}`).join('');
  const area = `${line}L${W} ${height}L0 ${height}Z`;
  return { line, area, last: { x: x(t1), y: y(pts[pts.length - 1][1]) } };
}
