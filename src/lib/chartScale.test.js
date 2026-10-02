import { describe, expect, it } from 'vitest';
import { fitDomain } from './chartScale';
import { windChill } from './windChill';

describe('fitDomain', () => {
  it('fits the data instead of starting at zero', () => {
    const [lo, hi] = fitDomain([72, 75, 81]);
    expect(lo).toBeGreaterThan(50);
    expect(lo).toBeLessThanOrEqual(72);
    expect(hi).toBeGreaterThanOrEqual(81);
    expect(hi).toBeLessThan(100);
  });

  it('extends to include a reference value when asked, and never goes below zero', () => {
    expect(fitDomain([150, 160], { include: [200] })[1]).toBeGreaterThanOrEqual(200);
    expect(fitDomain([0.2, 5])[0]).toBe(0);
  });
});

describe('windChill', () => {
  it('matches the published table (−20 °C at 30 km/h ≈ −33 °C)', () => {
    expect(windChill(-20, 30)).toBeCloseTo(-32.6, 0);
  });
  it('is undefined outside the formula range', () => {
    expect(windChill(15, 30)).toBeNull();
    expect(windChill(-20, 2)).toBeNull();
  });
});
