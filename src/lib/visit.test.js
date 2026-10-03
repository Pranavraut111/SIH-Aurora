import { describe, expect, it } from 'vitest';
import { visitEntry } from './visit';

describe('visit entry point', () => {
  it('names the link that was opened', () => {
    expect(visitEntry('')).toBe('main');
    expect(visitEntry('?story=blizzard&station=maitri')).toBe('story:blizzard');
    expect(visitEntry('?tour=start')).toBe('tour');
    expect(visitEntry('?module=logistics&station=maitri')).toBe('module:logistics');
    expect(visitEntry('?module=overview')).toBe('main');
  });

  it('never sends anything else', () => {
    expect(visitEntry('?story=volcano')).toBe('main');
    expect(visitEntry('?module=<script>')).toBe('main');
  });
});
