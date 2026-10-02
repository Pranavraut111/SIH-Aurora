import { describe, expect, it } from 'vitest';
import { centredAverage, CLOCKS, formatSpan, movingAverage, onModelClock, retime } from './modelClock';

const H = 3_600_000;

describe('model clock', () => {
  it('re-times wall-clock points onto the replay clock and drops points without one', () => {
    const pts = [[1000, 1], [3000, 2], [5000, 3]];
    const clock = [[3000, 10 * H], [5000, 10 * H + 240_000]];
    expect(retime(pts, clock)).toEqual([[10 * H, 2], [10 * H + 240_000, 3]]);
  });

  it('keeps only the newest stretch when the replay loops back', () => {
    const pts = [[1, 1], [2, 2], [3, 3]];
    const clock = [[1, 50 * H], [2, 51 * H], [3, 0]];
    expect(retime(pts, clock)).toEqual([[0, 3]]);
  });

  it('chooses the replay clock only when the snapshot has one and history can be re-timed', () => {
    const series = { 'a.b': [[1, 5], [2, 6]], 'replay.timeMs': [[1, H], [2, 2 * H]] };
    expect(onModelClock(series, ['a.b'], 2 * H).clock).toBe(CLOCKS.replay);
    expect(onModelClock(series, ['a.b'], null).clock).toBe(CLOCKS.wall);
    expect(onModelClock({ 'a.b': [[1, 5]] }, ['a.b'], 2 * H).clock).toBe(CLOCKS.wall);
  });

  it('computes a trailing moving average over the window', () => {
    const pts = [[0, 0], [1, 10], [2, 20], [3, 30]];
    expect(movingAverage(pts, 1).map(([, v]) => v)).toEqual([0, 5, 15, 25]);
  });

  it('computes a centred average without lag', () => {
    const pts = [[0, 0], [1, 10], [2, 20], [3, 30], [4, 40]];
    expect(centredAverage(pts, 2).map(([, v]) => v)).toEqual([5, 10, 20, 30, 35]);
  });

  it('formats spans for labels', () => {
    expect(formatSpan(H)).toBe('1 h');
    expect(formatSpan(60 * H)).toBe('60 h');
    expect(formatSpan(15 * 60_000)).toBe('15 min');
  });
});
