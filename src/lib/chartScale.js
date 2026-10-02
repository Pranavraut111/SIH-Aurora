/* Aurora — chart axis helpers. */
import { isNum } from './format';

/** A y-domain fitted to the data with round steps, never a fixed 0–max. */
export function fitDomain(values, { include = [] } = {}) {
  const v = [...values, ...include].filter(isNum);
  if (!v.length) return [0, 1];
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  const span = Math.max(hi - lo, Math.abs(hi) * 0.05, 1);
  lo -= span * 0.25;
  hi += span * 0.25;
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const a = Math.max(0, Math.floor(lo / step) * step);
  const b = Math.ceil(hi / step) * step;
  const domain = [a, b];
  // Evenly spaced ticks on the same step, so the axis reads 70 / 75 / 80, not 69 / 73 / 77.
  domain.ticks = Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => +(a + i * step).toFixed(6));
  return domain;
}
