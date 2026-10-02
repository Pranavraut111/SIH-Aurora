import { describe, expect, it } from 'vitest';
import { makeNoise, padWeight } from './noise';

describe('procedural terrain helpers', () => {
  it('noise is deterministic per seed, so screenshots are reproducible', () => {
    const a = makeNoise(7); const b = makeNoise(7); const c = makeNoise(8);
    expect(a.fbm(12.3, 4.5)).toBe(b.fbm(12.3, 4.5));
    expect(a.fbm(12.3, 4.5)).not.toBe(c.fbm(12.3, 4.5));
    for (let i = 0; i < 50; i += 1) { const v = a.value(i * 0.37, i * 0.91); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('a pad is flat inside, feathers out, and has no effect far away', () => {
    const pad = { x: 0, z: 0, hx: 10, hz: 5, feather: 20 };
    expect(padWeight(3, 2, pad)).toBe(1);
    expect(padWeight(20, 0, pad)).toBeGreaterThan(0);
    expect(padWeight(20, 0, pad)).toBeLessThan(1);
    expect(padWeight(60, 0, pad)).toBe(0);
  });
});
