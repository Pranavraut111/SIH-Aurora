/* Product tour preferences: the versioned seen-flag survives broken storage, and ?tour= is read once. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return import('./tourPrefs');
};

// An in-memory Storage: Node 25's own global localStorage shadows jsdom's and is unusable
// without --localstorage-file, so the tests bring their own.
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

describe('seen flag', () => {
  it('is versioned and remembered in localStorage', async () => {
    const { TOUR_KEY, markTourSeen, tourSeen } = await load();
    expect(TOUR_KEY).toMatch(/^aurora-tour-v\d+$/);
    expect(tourSeen()).toBe(false);
    markTourSeen('completed');
    expect(JSON.parse(window.localStorage.getItem(TOUR_KEY)).outcome).toBe('completed');
    const fresh = await load();
    expect(fresh.tourSeen()).toBe(true);
  });

  it('falls back to memory when storage throws, so the tour shows once and never loops', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { markTourSeen, tourSeen } = await load();
    expect(tourSeen()).toBe(false);
    markTourSeen('skipped');
    expect(tourSeen()).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('?tour=', () => {
  it('reads off and keeps it in the URL', async () => {
    window.history.replaceState(null, '', '/?module=energy&tour=off');
    const { readTourParam } = await load();
    expect(readTourParam()).toBe('off');
    expect(window.location.search).toBe('?module=energy&tour=off');
  });

  it('reads start and removes it, so a reload does not restart the tour', async () => {
    window.history.replaceState(null, '', '/?tour=start&station=bharati');
    const { readTourParam } = await load();
    expect(readTourParam()).toBe('start');
    expect(window.location.search).toBe('?station=bharati');
  });

  it('ignores anything else', async () => {
    window.history.replaceState(null, '', '/?tour=maybe');
    const { readTourParam } = await load();
    expect(readTourParam()).toBeNull();
  });
});
