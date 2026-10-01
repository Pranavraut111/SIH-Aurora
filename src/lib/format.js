/* ═══════════════════════════════════════════════════════════════
   Aurora — the ONE number / unit / time formatting convention for the UI
   (docs/ui-redesign.md §5).

   - Missing values render as an em dash, never 0.
   - Numbers use international digit grouping (1,234.5) and a fixed number of
     decimals per quantity, so columns line up in tabular figures.
   - Units follow the value after a thin no-break space; % and ° attach directly.
   - Times are shown in IST (Asia/Kolkata) with an explicit "IST" suffix, plus a
     relative age where freshness matters.
   ═══════════════════════════════════════════════════════════════ */

export const DASH = '—';
const THIN_NBSP = ' ';

const numberFormats = new Map();
function nf(decimals) {
  if (!numberFormats.has(decimals)) {
    numberFormats.set(decimals, new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }));
  }
  return numberFormats.get(decimals);
}

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 68400 → "68,400"; 15.97 (1) → "16.0"; null → "—". */
export function formatNumber(value, decimals = 0) {
  return isNum(value) ? nf(decimals).format(value) : DASH;
}

/** Value with unit: (77.35, 'kW') → "77 kW"; (64.09, '°C', 1) → "64.1 °C"; (39, '%') → "39%". */
export function formatValue(value, unit, decimals = 0) {
  const n = formatNumber(value, decimals);
  if (n === DASH || !unit) return n;
  return unit === '%' ? `${n}%` : `${n}${THIN_NBSP}${unit}`;
}

const istTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const istDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function toDate(ts) {
  if (ts == null || ts === '') return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "22:31:05 IST" */
export function formatTimeIST(ts) {
  const d = toDate(ts);
  return d ? `${istTime.format(d)} IST` : DASH;
}

/** "02 Oct 2026, 22:31 IST" */
export function formatDateTimeIST(ts) {
  const d = toDate(ts);
  return d ? `${istDateTime.format(d)} IST` : DASH;
}

/** "just now", "12 s ago", "4 min ago", "3 h ago", "2 d ago". */
export function formatRelative(ts, now = Date.now()) {
  const d = toDate(ts);
  if (!d) return DASH;
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 0) return 'in the future';
  if (s < 3) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
