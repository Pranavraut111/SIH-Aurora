/* ═══════════════════════════════════════════════════════════════
   Aurora — URL state: ?module=<id>&station=<id>. Refresh-safe and shareable;
   back/forward move between pages. Unknown values fall back to the defaults
   (overview, first station) instead of breaking the app.
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useRef } from 'react';
import { STATION_IDS } from '../data/stationConfig';
import { MODULES } from './navigation';

export function parseUrlState(search) {
  const p = new URLSearchParams(search);
  const module = p.get('module');
  const station = p.get('station');
  return {
    module: module && Object.hasOwn(MODULES, module) ? module : 'overview',
    station: station && STATION_IDS.includes(station) ? station : STATION_IDS[0],
  };
}

export function buildSearch(module, station, search = '') {
  const p = new URLSearchParams(search);
  p.set('module', module);
  p.set('station', station);
  return `?${p.toString()}`;
}

export const initialUrlState = () => (typeof window === 'undefined' ? parseUrlState('') : parseUrlState(window.location.search));

/** Keep the URL in step with (module, station); call onPop when the user goes back/forward. */
export function useUrlState(module, station, onPop) {
  const first = useRef(true);
  const popRef = useRef(onPop);
  useEffect(() => { popRef.current = onPop; });

  useEffect(() => {
    const next = buildSearch(module, station, window.location.search);
    if (next === window.location.search) { first.current = false; return; }
    // The first sync normalises the URL in place; later changes add history entries.
    window.history[first.current ? 'replaceState' : 'pushState'](null, '', `${window.location.pathname}${next}${window.location.hash}`);
    first.current = false;
  }, [module, station]);

  useEffect(() => {
    const onPopState = () => popRef.current?.(parseUrlState(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
