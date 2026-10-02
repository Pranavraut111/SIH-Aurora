import { describe, expect, it } from 'vitest';
import { ANTARCTICA_PATH, project } from '../shell/antarctica';
import { SCALE, parsePath, stationPoint } from './continent';

describe('Antarctica view geometry', () => {
  it('parses every polygon of the Natural Earth outline', () => {
    const polys = parsePath(ANTARCTICA_PATH);
    expect(polys.length).toBe((ANTARCTICA_PATH.match(/M/g) || []).length);
    polys.forEach((p) => expect(p.length).toBeGreaterThanOrEqual(3));
  });

  it('pins stations with the same projection as the locator (0° meridian toward −z)', () => {
    const m = stationPoint(-70.77, 11.73);
    const [x, y] = project(-70.77, 11.73);
    expect(m.x).toBeCloseTo(x * SCALE);
    expect(m.z).toBeCloseTo(y * SCALE);
    expect(m.z).toBeLessThan(0);                       // Maitri is near the 0° meridian: "up"
    expect(stationPoint(-69.41, 76.19).x).toBeGreaterThan(0);   // Bharati at 76° E: to the right
  });
});
