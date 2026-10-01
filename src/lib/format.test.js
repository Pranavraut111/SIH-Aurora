import { describe, expect, it } from 'vitest';
import { DASH, formatDateTimeIST, formatNumber, formatRelative, formatTimeIST, formatValue } from './format';

describe('formatNumber', () => {
  it('groups digits and fixes decimals', () => {
    expect(formatNumber(68400)).toBe('68,400');
    expect(formatNumber(15.97, 1)).toBe('16.0');
    expect(formatNumber(1499.25)).toBe('1,499');
  });

  it('renders missing values as a dash, never 0', () => {
    for (const v of [null, undefined, NaN, Infinity, '12']) expect(formatNumber(v)).toBe(DASH);
  });
});

describe('formatValue', () => {
  it('puts a thin no-break space before units, none before %', () => {
    expect(formatValue(77.35, 'kW')).toBe('77 kW');
    expect(formatValue(64.09, '°C', 1)).toBe('64.1 °C');
    expect(formatValue(38.7, '%')).toBe('39%');
    expect(formatValue(null, 'kW')).toBe(DASH);
  });
});

describe('IST time', () => {
  // 2026-10-02T17:01:05Z is 22:31:05 in Asia/Kolkata (UTC+5:30, no DST).
  const ts = Date.UTC(2026, 9, 2, 17, 1, 5);

  it('formats in Asia/Kolkata with an explicit suffix', () => {
    expect(formatTimeIST(ts)).toBe('22:31:05 IST');
    expect(formatDateTimeIST(ts)).toBe('02 Oct 2026, 22:31 IST');
  });

  it('accepts ISO strings and rejects garbage', () => {
    expect(formatTimeIST('2026-10-02T17:01:05Z')).toBe('22:31:05 IST');
    expect(formatTimeIST('not a date')).toBe(DASH);
    expect(formatTimeIST(null)).toBe(DASH);
  });
});

describe('formatRelative', () => {
  const now = 1_800_000_000_000;
  it('describes age in the largest sensible unit', () => {
    expect(formatRelative(now - 1000, now)).toBe('just now');
    expect(formatRelative(now - 12_000, now)).toBe('12 s ago');
    expect(formatRelative(now - 4 * 60_000, now)).toBe('4 min ago');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe('2 d ago');
    expect(formatRelative(null, now)).toBe(DASH);
  });
});
