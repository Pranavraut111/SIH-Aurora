import { describe, expect, it } from 'vitest';
import { fitDomain, sharesTo100 } from './chartScale';
import { frostbiteRisk, windChill } from './windChill';

describe('fitDomain', () => {
  it('fits the data instead of starting at zero', () => {
    const [lo, hi] = fitDomain([72, 75, 81]);
    expect(lo).toBeGreaterThan(50);
    expect(lo).toBeLessThanOrEqual(72);
    expect(hi).toBeGreaterThanOrEqual(81);
    expect(hi).toBeLessThan(100);
  });

  it('keeps negative data on its own range (°C)', () => {
    const [lo, hi] = fitDomain([-12.9, -9.8]);
    expect(lo).toBeLessThanOrEqual(-12.9);
    expect(hi).toBeGreaterThanOrEqual(-9.8);
    expect(lo).toBeLessThan(hi);
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

describe('sharesTo100', () => {
  it('rounds consumer shares so they add up to exactly 100', () => {
    const shares = sharesTo100([44, 22.1, 8, 3, 1.5]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([56, 28, 10, 4, 2]);
  });
  it('is all zeros when there is nothing to share', () => {
    expect(sharesTo100([0, 0])).toEqual([0, 0]);
  });
});

describe('frostbiteRisk', () => {
  it('follows the Environment Canada bands', () => {
    expect(frostbiteRisk(-5).level).toBe('Low');
    expect(frostbiteRisk(-20).level).toBe('Moderate');
    expect(frostbiteRisk(-30).text).toMatch(/10–30 minutes/);
    expect(frostbiteRisk(-45).text).toMatch(/5–10 minutes/);
    expect(frostbiteRisk(-60).level).toBe('Extreme');
    expect(frostbiteRisk(null)).toBeNull();
  });
});
