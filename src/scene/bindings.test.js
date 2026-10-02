import { describe, expect, it } from 'vitest';
import { STATUS_HEX, atmosphere, detectTier, driftIntensity, levelOf, nightFactor, phaseOf, smoothToward, visibilityMetres } from './bindings';
import { status } from '../theme/tokens';

describe('alert levels and colours', () => {
  it('only warning and critical are alerts; anything else is normal', () => {
    expect(levelOf({ a: 'critical', b: 'warning', c: 'offline' }, 'a')).toBe('critical');
    expect(levelOf({ a: 'critical', b: 'warning', c: 'offline' }, 'b')).toBe('warning');
    expect(levelOf({ c: 'offline' }, 'c')).toBe('normal');
    expect(levelOf(undefined, 'x')).toBe('normal');
  });

  it('uses the v2 status tokens (dark set), never new colours', () => {
    expect(STATUS_HEX).toEqual({ normal: status.dark.normal.main, warning: status.dark.warning.main, critical: status.dark.critical.main });
  });
});

describe('quality tier', () => {
  it('phones and tiny devices get the low tier; laptops the high tier', () => {
    expect(detectTier({ coarsePointer: true, minScreen: 390 })).toBe('low');
    expect(detectTier({ deviceMemory: 2 })).toBe('low');
    expect(detectTier({ coarsePointer: false, minScreen: 900, deviceMemory: 8, cores: 8 })).toBe('high');
    expect(detectTier({ coarsePointer: true, minScreen: 1080 })).toBe('high');   // touch laptop
  });
});

describe('wind → blowing snow', () => {
  it('no drift below 15 km/h, full drift by 70 km/h, monotonic in between', () => {
    expect(driftIntensity(0)).toBe(0);
    expect(driftIntensity(14.9)).toBe(0);
    expect(driftIntensity(null)).toBe(0);
    expect(driftIntensity(70)).toBe(1);
    const xs = [16, 25, 35, 45, 55, 65].map(driftIntensity);
    xs.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(xs[i]));
    expect(driftIntensity(55)).toBeGreaterThan(0.6);
  });

  it('visibility drops from ≈2.4 km calm to a few hundred metres in a blizzard', () => {
    expect(visibilityMetres(0)).toBe(2400);
    expect(visibilityMetres(1)).toBeLessThan(400);
  });

  it('smoothing moves toward the target without overshooting', () => {
    const v = smoothToward(0, 1, 1, 8);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
    expect(smoothToward(NaN, 0.4, 1)).toBe(0.4);
  });
});

describe('sun → light', () => {
  it('names day, twilight and night by the sun elevation', () => {
    expect(phaseOf(5)).toBe('day');
    expect(phaseOf(-3)).toBe('twilight');
    expect(phaseOf(-20)).toBe('night');
  });

  it('windows light up after sunset; fully by the end of civil twilight', () => {
    expect(nightFactor(10)).toBe(0);
    expect(nightFactor(-3)).toBeGreaterThan(0);
    expect(nightFactor(-6)).toBe(1);
  });

  it('no direct sun at night, but the moonlight fill keeps the scene legible', () => {
    const night = atmosphere(-25);
    const day = atmosphere(12);
    expect(night.sunIntensity).toBe(0);
    expect(night.moon).toBeGreaterThan(day.moon);
    expect(night.hemiIntensity).toBeGreaterThan(0.3);
    expect(day.sunIntensity).toBeGreaterThan(1);
  });
});
