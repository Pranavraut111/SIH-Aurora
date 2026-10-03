import { describe, expect, it } from 'vitest';
import { formatIn, freshnessLine } from './ncporFreshness';

const NOW = Date.UTC(2026, 9, 3, 6, 0, 0);
const min = 60_000;

describe('NCPOR freshness line', () => {
  it('a healthy sync: when, how many readings, when next', () => {
    const line = freshnessLine({ lastStatus: 'success', lastSuccess: NOW - 12 * min, lastReadings: 100, nextSync: NOW + 18 * min },
      { enabled: true, now: NOW });
    expect(line.status).toBe('normal');
    expect(line.text).toBe('Last synced 12 min ago · 100 values · next sync in 18 min');
  });

  it('a failing page: since when, and that the last good data is shown', () => {
    const line = freshnessLine({
      lastStatus: 'failed', lastMessage: 'NCPOR page unreachable: timed out', failingSince: Date.UTC(2026, 9, 3, 3, 40),
      lastSuccess: NOW - 3 * 60 * min, nextSync: NOW + 40 * min,
    }, { enabled: true, now: NOW });
    expect(line.status).toBe('warning');
    expect(line.text).toBe('NCPOR page unreachable since 09:10:00 IST, showing the last good data (synced 3 h ago). Next try in 40 min.');
  });

  it('never synced, and automatic sync off', () => {
    expect(freshnessLine({ lastStatus: null, nextSync: NOW + 20_000 }, { enabled: true, now: NOW }).text)
      .toBe('Not synced yet; next sync in 20 s.');
    expect(freshnessLine({ lastStatus: 'success', lastSuccess: NOW - min, lastReadings: 25, nextSync: null }, { enabled: false, now: NOW }).text)
      .toBe('Last synced 1 min ago · 25 values · automatic sync off');
  });

  it('formats the time until the next sync', () => {
    expect(formatIn(NOW - 1, NOW)).toBe('due now');
    expect(formatIn(NOW + 90 * min, NOW)).toBe('in 2 h');
    expect(formatIn(null, NOW)).toBeNull();
  });
});
