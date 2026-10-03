/* Aurora — the NCPOR freshness line in plain words (NcporFreshness.jsx), from one
   station's record in GET /ncpor/status (ncpor_sync.py). */
import { formatNumber, formatRelative, formatTimeIST } from './format';

/** "in 18 min", "in 40 s", "due now". */
export function formatIn(ts, now = Date.now()) {
  if (!ts) return null;
  const s = Math.round((ts - now) / 1000);
  if (s <= 0) return 'due now';
  if (s < 60) return `in ${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
}

/** One station's line and its status colour, from the backend's status record. */
export function freshnessLine(st, { enabled, now = Date.now() }) {
  const next = enabled ? formatIn(st.nextSync, now) : null;
  const nextText = st.running ? 'syncing now' : next ? `next sync ${next}` : 'automatic sync off';
  if (st.lastStatus === 'failed') {
    const since = st.failingSince ? ` since ${formatTimeIST(st.failingSince)}` : '';
    const what = /unreachable/i.test(st.lastMessage || '') ? 'NCPOR page unreachable' : 'NCPOR sync failing';
    const good = st.lastSuccess ? `showing the last good data (synced ${formatRelative(st.lastSuccess, now)})` : 'no good data yet';
    return { status: 'warning', text: `${what}${since}, ${good}. ${next ? `Next try ${next}.` : ''}`.trim(), detail: st.lastMessage };
  }
  if (!st.lastSuccess) {
    return { status: 'offline', text: `Not synced yet${enabled ? `; ${nextText}` : ''}.` };
  }
  return {
    status: 'normal',
    text: `Last synced ${formatRelative(st.lastSuccess, now)} · ${formatNumber(st.lastReadings)} values · ${nextText}`,
  };
}

