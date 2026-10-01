/* ═══════════════════════════════════════════════════════════════
   Aurora — operator name used for audit fields (who acknowledged an
   alert, who edited inventory, who dispatched a simulated command).
   There is NO authentication: this is a self-declared name, stored
   per browser. Must match the backend rule (validation.py).
   ═══════════════════════════════════════════════════════════════ */
const KEY = 'aurora.operatorName';
export const DEFAULT_OPERATOR = 'dashboard operator';
export const OPERATOR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 .,'()_-]{1,59}$/;

export function getOperatorName() {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && OPERATOR_NAME_RE.test(v) ? v : DEFAULT_OPERATOR;
  } catch (err) {
    console.warn('[operator] localStorage unavailable; using default name', err);
    return DEFAULT_OPERATOR;
  }
}

/** Returns true when saved; false when the name is invalid or storage is unavailable. */
export function setOperatorName(name) {
  const v = String(name || '').trim();
  if (!OPERATOR_NAME_RE.test(v)) return false;
  try {
    window.localStorage.setItem(KEY, v);
    return true;
  } catch (err) {
    console.warn('[operator] could not persist operator name', err);
    return false;
  }
}
