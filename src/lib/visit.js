/* Aurora — the visit beacon (Administration → Visits). Loaded after startup by main.jsx,
   so nothing is added to the startup bundle. One POST per page load: no cookie, no
   storage, no identifier; the backend keeps aggregate counts only (simulator/visits.py).
   The entry point says which link was opened: the main page, a story, a page or the tour. */
import { apiPost } from '../services/api';

export function visitEntry(search) {
  const q = new URLSearchParams(search || '');
  const story = q.get('story');
  if (story && /^(blizzard|generator|fuel|linkloss)$/.test(story)) return `story:${story}`;
  if (q.get('tour') === 'start') return 'tour';
  const mod = q.get('module');
  if (mod && /^[A-Za-z]{1,32}$/.test(mod) && mod !== 'overview') return `module:${mod}`;
  return 'main';
}

export function recordVisit(search) {
  return apiPost('/visit', { entry: visitEntry(search) }, { quiet: true })
    .catch((err) => console.warn('[visit] not counted', err?.message || err));
}
