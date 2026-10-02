/* ═══════════════════════════════════════════════════════════════
   Aurora — product tour preferences (docs/ui-redesign.md §6). Startup code:
   tiny, no driver.js. The tour itself (runTour.js) loads on first start.

   Seen-flag: localStorage `aurora-tour-v<N>`. Bump TOUR_VERSION after a big UI
   change and everyone sees the tour once more. Storage can be missing or throw
   (private windows, blocked site data): then the flag lives in memory for this
   page load only, so the tour still shows once and never loops.

   URL: ?tour=off never auto-starts (screenshots, demos; it stays in the URL so a
   reload keeps it off), ?tour=start always starts once (removed from the URL
   after reading, so a reload doesn't restart it).
   ═══════════════════════════════════════════════════════════════ */
export const TOUR_VERSION = 1;
export const TOUR_KEY = `aurora-tour-v${TOUR_VERSION}`;

/** Pages with their own short tour ("Tour this page" in the page header). */
export const PAGE_TOURS = {
  environmental: 'Weather',
  infrastructure: 'Infrastructure',
  simulation: 'What-if scenarios',
  admin: 'Alert thresholds',
};

let seenInMemory = false;

export function tourSeen() {
  if (seenInMemory) return true;
  try {
    return window.localStorage.getItem(TOUR_KEY) !== null;
  } catch (err) {
    console.warn('[tour] localStorage unavailable; remembering the tour for this page load only', err);
    return false;
  }
}

export function markTourSeen(outcome) {
  seenInMemory = true;
  try {
    window.localStorage.setItem(TOUR_KEY, JSON.stringify({ outcome, at: new Date().toISOString() }));
  } catch (err) {
    console.warn('[tour] could not store the tour flag', err);
  }
}

/** 'off' | 'start' | null, from ?tour=. Reads once; drops ?tour=start from the URL. */
export function readTourParam() {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const v = p.get('tour');
  if (v === 'start') {
    p.delete('tour');
    const q = p.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
  }
  return v === 'off' || v === 'start' ? v : null;
}
