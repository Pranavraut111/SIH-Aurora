/* Guided stories: ?story= deep links are read once; the welcome card shows once. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return import('./storyMeta');
};

// Node 25's global localStorage shadows jsdom's (see tourPrefs.test.js): bring our own.
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('localStorage', memoryStorage());
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('story deep links', () => {
  it('reads ?story= once and removes it from the URL, keeping the rest', async () => {
    const { readStoryParam } = await load();
    window.history.replaceState(null, '', '/?module=overview&story=generator&station=bharati');
    expect(readStoryParam()).toBe('generator');
    expect(window.location.search).toBe('?module=overview&station=bharati');
    expect(readStoryParam()).toBeNull();
  });

  it('ignores unknown stories', async () => {
    const { readStoryParam } = await load();
    window.history.replaceState(null, '', '/?story=volcano');
    expect(readStoryParam()).toBeNull();
  });

  it('every story names a station; scenario stories name a public scenario', async () => {
    const { STORY_META } = await load();
    Object.values(STORY_META).forEach((m) => expect(['maitri', 'bharati']).toContain(m.station));
    expect(STORY_META.blizzard.scenario).toBe('blizzard');
    expect(STORY_META.generator.scenario).toBe('generator_failure');
    expect(STORY_META.fuel.scenario).toBeNull();
  });
});

describe('welcome card', () => {
  it('is shown once, and remembered', async () => {
    const { markWelcomeSeen, welcomeSeen } = await load();
    expect(welcomeSeen()).toBe(false);
    markWelcomeSeen('explore');
    expect(welcomeSeen()).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('aurora-welcome-v1')).choice).toBe('explore');
    const fresh = await load();
    expect(fresh.welcomeSeen()).toBe(true);
  });

  it('survives broken storage: remembered for this page load only', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    const { markWelcomeSeen, welcomeSeen } = await load();
    expect(welcomeSeen()).toBe(false);
    markWelcomeSeen('tour');
    expect(welcomeSeen()).toBe(true);
  });
});
