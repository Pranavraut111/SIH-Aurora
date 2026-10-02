import { describe, expect, it } from 'vitest';
import { PHASES, arcPoint, ease, flightPlan, phaseAt, transitionFor } from './flyover';

describe('fly-over', () => {
  it('lasts about 4 s from a station, and skips the rise from the Antarctica view', () => {
    expect(flightPlan('station')).toEqual({ phases: ['rise', 'glide', 'descend'], total: 4 });
    expect(flightPlan('antarctica').phases).toEqual(['glide', 'descend']);
  });

  it('reports the phase and progress, and null once done', () => {
    const plan = flightPlan('station');
    expect(phaseAt(plan, 0)).toEqual({ phase: 'rise', u: 0 });
    expect(phaseAt(plan, PHASES.rise + 1)).toEqual({ phase: 'glide', u: 0.5 });
    expect(phaseAt(plan, 3.5).phase).toBe('descend');
    expect(phaseAt(plan, 4.01)).toBeNull();
  });

  it('eases with the design system curve: 0 → 1, monotonic', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let prev = 0;
    for (let t = 0.05; t < 1; t += 0.05) { const v = ease(t); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(ease(0.5)).toBeGreaterThan(0.7);   // fast start, long settle
  });

  it('the arc starts and ends at the stations and is lifted in the middle', () => {
    const a = [0, 0, 0]; const b = [100, 0, 0];
    expect(arcPoint(a, b, 0, 50)).toEqual(a);
    expect(arcPoint(a, b, 1, 50)).toEqual(b);
    expect(arcPoint(a, b, 0.5, 50)[1]).toBeCloseTo(25);
  });

  it('reduced motion and the low tier crossfade instead of flying; the first station has no transition', () => {
    expect(transitionFor({ first: true })).toBe('none');
    expect(transitionFor({ reducedMotion: true, tier: 'high' })).toBe('crossfade');
    expect(transitionFor({ reducedMotion: false, tier: 'low' })).toBe('crossfade');
    expect(transitionFor({ reducedMotion: false, tier: 'high' })).toBe('flyover');
  });
});
