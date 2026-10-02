/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — fly-over timing and paths (pure, unit-tested).
   From a station: rise (1 s) → glide over the continent along the arc
   (2 s) → descend into the other station (1 s). From the Antarctica view
   the rise is skipped. One easing, the design system's
   cubic-bezier(0.2, 0, 0, 1). Under reduced motion (or on the low tier)
   there is no flight: a 200 ms crossfade instead.
   ═══════════════════════════════════════════════════════════════ */

/** cubic-bezier(x1, y1, x2, y2) easing as a function of t ∈ [0, 1]. */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const err = sx(t) - x;
      const d = dx(t);
      if (Math.abs(err) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    t = Math.min(1, Math.max(0, t));
    return sy(t);
  };
}

export const ease = cubicBezier(0.2, 0, 0, 1);
/** Symmetric ease for the glide (slow start and end over the continent). */
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeIn = (t) => t * t * t;

export const PHASES = { rise: 1.0, glide: 2.0, descend: 1.0 };

/** The flight's phases from the current view. */
export function flightPlan(fromView) {
  const phases = fromView === 'antarctica' ? ['glide', 'descend'] : ['rise', 'glide', 'descend'];
  return { phases, total: phases.reduce((s, p) => s + PHASES[p], 0) };
}

/** Which phase is active at `elapsed` seconds, and how far through it (0–1). Null once done. */
export function phaseAt(plan, elapsed) {
  let t = elapsed;
  for (const p of plan.phases) {
    if (t < PHASES[p]) return { phase: p, u: t / PHASES[p] };
    t -= PHASES[p];
  }
  return null;
}

/** Point on a quadratic Bézier from a to b whose control point is the midpoint lifted by `lift`. */
export function arcPoint(a, b, t, lift) {
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + lift, (a[2] + b[2]) / 2];
  const u = 1 - t;
  return [0, 1, 2].map((i) => u * u * a[i] + 2 * u * t * m[i] + t * t * b[i]);
}

/** Transition for a station switch, given the user's motion preference and the quality tier. */
export function transitionFor({ reducedMotion, tier, first }) {
  if (first) return 'none';
  return reducedMotion || tier === 'low' ? 'crossfade' : 'flyover';
}
