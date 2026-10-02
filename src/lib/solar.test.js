import { describe, expect, it } from 'vitest';
import { dayState, solarAzimuth, solarElevation, solarPosition, solarTimeOffsetMs } from './solar';

const MAITRI = [-70.77, 11.73];

describe('solar position', () => {
  it('puts the sun near the zenith at the equator at an equinox noon (UTC, lon 0)', () => {
    expect(solarElevation(Date.UTC(2026, 2, 20, 12, 7), 0, 0)).toBeGreaterThan(88);
  });

  it('Maitri has polar night at the June solstice: noon sun ~4° below the horizon', () => {
    const s = dayState(Date.UTC(2026, 5, 21, 0, 0), ...MAITRI);
    expect(s.state).toBe('polar-night');
    expect(s.max).toBeGreaterThan(-5.5);
    expect(s.max).toBeLessThan(-3);
    expect(s.next).toBeNull();
  });

  it('Maitri has the midnight sun at the December solstice', () => {
    const s = dayState(Date.UTC(2026, 11, 21, 0, 0), ...MAITRI);
    expect(s.state).toBe('polar-day');
    expect(s.min).toBeGreaterThan(2.5);
  });

  it('gives a sunset during a normal day and a sunrise at night (early October)', () => {
    const noonLocal = Date.UTC(2026, 9, 2, 11, 13);         // ≈ local solar noon at 11.73° E
    const day = dayState(noonLocal, ...MAITRI);
    expect(day.state).toBe('day');
    expect(day.next.getTime()).toBeGreaterThan(noonLocal);
    const night = dayState(noonLocal + 12 * 3_600_000, ...MAITRI);
    expect(night.state).toBe('night');
    expect(day.curve.length).toBeGreaterThan(70);
  });

  it('local mean solar time follows longitude: 15° per hour', () => {
    expect(solarTimeOffsetMs(15)).toBe(3_600_000);
    expect(solarTimeOffsetMs(-7.5)).toBe(-1_800_000);
  });
});

describe('solar azimuth', () => {
  it('agrees with solarElevation', () => {
    const t = Date.UTC(2026, 8, 3, 9, 30);
    expect(solarPosition(t, ...MAITRI).elevation).toBeCloseTo(solarElevation(t, ...MAITRI), 6);
  });

  it('in the southern high latitudes the noon sun is due north', () => {
    // Local solar noon at Maitri (11.73° E) is about 11:13 UTC.
    const az = solarAzimuth(Date.UTC(2026, 11, 21, 11, 13), ...MAITRI);
    expect(Math.min(az, 360 - az)).toBeLessThan(3);
  });

  it('the sun rises in the east-ish half and sets in the west-ish half', () => {
    // Early October at Maitri: morning sun is east of north, evening sun west of north.
    expect(solarAzimuth(Date.UTC(2026, 9, 2, 7, 0), ...MAITRI)).toBeGreaterThan(30);
    expect(solarAzimuth(Date.UTC(2026, 9, 2, 7, 0), ...MAITRI)).toBeLessThan(150);
    expect(solarAzimuth(Date.UTC(2026, 9, 2, 15, 30), ...MAITRI)).toBeGreaterThan(210);
    expect(solarAzimuth(Date.UTC(2026, 9, 2, 15, 30), ...MAITRI)).toBeLessThan(330);
  });
});
