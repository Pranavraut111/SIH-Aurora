import { describe, expect, it } from 'vitest';
import { buildSearch, parseUrlState } from './urlState';

describe('URL state', () => {
  it('reads module and station', () => {
    expect(parseUrlState('?module=energy&station=bharati')).toEqual({ module: 'energy', station: 'bharati' });
  });
  it('falls back to the defaults for unknown or missing values', () => {
    expect(parseUrlState('?module=nope&station=atlantis')).toEqual({ module: 'overview', station: 'maitri' });
    expect(parseUrlState('')).toEqual({ module: 'overview', station: 'maitri' });
    expect(parseUrlState('?module=__proto__').module).toBe('overview');
  });
  it('keeps other parameters when writing', () => {
    expect(buildSearch('ai', 'maitri', '?debug=1')).toBe('?debug=1&module=ai&station=maitri');
  });
});
