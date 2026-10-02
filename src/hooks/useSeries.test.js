import { describe, expect, it } from 'vitest';
import { appendSnapshot, mergeSeries, rollingMean, valueAgo } from './useSeries';

const MIN = 60_000;

describe('useSeries helpers', () => {
  it('appends one point per key and trims to the window', () => {
    let s = {};
    s = appendSnapshot(s, ['generator.gen_power'], { generator: { gen_power: 70 } }, 0, 10 * MIN);
    s = appendSnapshot(s, ['generator.gen_power'], { generator: { gen_power: 71 } }, 5 * MIN, 10 * MIN);
    s = appendSnapshot(s, ['generator.gen_power'], { generator: { gen_power: 72 } }, 12 * MIN, 10 * MIN);
    expect(s['generator.gen_power']).toEqual([[5 * MIN, 71], [12 * MIN, 72]]);
  });

  it('ignores a repeated timestamp and missing values', () => {
    const s = { 'a.b': [[1000, 1]] };
    expect(appendSnapshot(s, ['a.b'], { a: { b: 2 } }, 1000, MIN)).toBe(s);
    expect(appendSnapshot(s, ['a.b'], { a: {} }, 2000, MIN)).toBe(s);
  });

  it('merges live points after the backend history without duplicates', () => {
    const merged = mergeSeries({ 'a.b': [[1, 1], [2, 2]] }, { 'a.b': [[2, 2], [3, 3]] });
    expect(merged['a.b']).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it('valueAgo returns null until the window reaches back far enough', () => {
    const pts = [[0, 10], [10 * MIN, 20], [20 * MIN, 30]];
    expect(valueAgo(pts, 15 * MIN)).toBe(10);
    expect(valueAgo(pts, 25 * MIN)).toBeNull();
  });

  it('rollingMean averages the last window and reports its span', () => {
    const pts = [[0, 100], [10 * MIN, 10], [20 * MIN, 20]];
    expect(rollingMean(pts, 15 * MIN)).toEqual({ mean: 15, spanMs: 10 * MIN, n: 2 });
    expect(rollingMean([], 15 * MIN).mean).toBeNull();
  });
});
