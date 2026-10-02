import { describe, expect, it } from 'vitest';
import { matchCommand } from './commandMatch';

describe('command matching', () => {
  const cmd = { label: 'Go to Energy grid', group: 'Pages', keywords: 'generator fuel' };
  it('matches word prefixes in any order', () => {
    expect(matchCommand(cmd, 'ener')).toBe(true);
    expect(matchCommand(cmd, 'fuel go')).toBe(true);
    expect(matchCommand(cmd, '')).toBe(true);
  });
  it('rejects when any word does not match', () => {
    expect(matchCommand(cmd, 'energy weather')).toBe(false);
  });
});
