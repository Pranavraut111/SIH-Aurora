/* ═══════════════════════════════════════════════════════════════
   Aurora — operator token for write access.

   The token lives in MEMORY ONLY. It is deliberately never written to
   localStorage or sessionStorage: a demo deployment is public, and a token left
   in storage would survive the tab, be readable by anything running on the
   origin, and outlive the operator's session. Refreshing the page logs you out.

   `writeProtected` comes from GET /api/admin/session, so when the server has no
   ADMIN_TOKEN set (local development) the UI leaves every control enabled.
   ═══════════════════════════════════════════════════════════════ */

let token = null;
let writeProtected = null;   // null = not yet known
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.error('[adminToken] subscriber threw', err);
    }
  }
}

/** Subscribe to login/logout and protection-state changes. Returns an unsubscribe fn. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getToken() {
  return token;
}

export function isLoggedIn() {
  return token !== null;
}

/** True once the server has told us it requires a token for writes. */
export function isWriteProtected() {
  return writeProtected === true;
}

/** null until GET /api/admin/session has answered. */
export function getWriteProtection() {
  return writeProtected;
}

/**
 * Whether write controls should be enabled: either the server does not protect
 * writes, or we are holding a token. Unknown protection is treated as "allowed",
 * so a failed probe never locks a local developer out of their own dashboard —
 * the backend is the thing that actually enforces this.
 */
export function canWrite() {
  return writeProtected !== true || token !== null;
}

export function setToken(value) {
  const next = value ? String(value) : null;
  if (next === token) return;
  token = next;
  notify();
}

export function clearToken() {
  if (token === null) return;
  token = null;
  notify();
}

export function setWriteProtected(value) {
  const next = value === null ? null : Boolean(value);
  if (next === writeProtected) return;
  writeProtected = next;
  notify();
}
