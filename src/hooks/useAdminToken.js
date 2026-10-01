/* ═══════════════════════════════════════════════════════════════
   Aurora — React view of the in-memory operator token.
   Learns from GET /api/admin/session whether the server protects writes at all,
   so local development (no ADMIN_TOKEN) keeps every control enabled.
   ═══════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useState } from 'react';
import {
  canWrite,
  clearToken,
  getToken,
  getWriteProtection,
  setToken,
  setWriteProtected,
  subscribe,
} from '../services/adminToken';
import { apiGet } from '../services/api';

function snapshot() {
  return {
    loggedIn: getToken() !== null,
    writeProtected: getWriteProtection(),
    canWrite: canWrite(),
  };
}

/** Ask the backend whether writes need a token, and whether `token` is accepted. */
async function probeSession(token) {
  const res = await apiGet('/admin/session', token ? { headers: { 'X-Admin-Token': token } } : undefined);
  setWriteProtected(res.writeProtected);
  return res;
}

export function useAdminToken() {
  const [state, setState] = useState(snapshot);

  useEffect(() => subscribe(() => setState(snapshot())), []);

  // One probe on mount so the UI knows whether to disable write controls.
  useEffect(() => {
    let cancelled = false;
    probeSession(getToken()).catch((err) => {
      if (!cancelled) {
        // Unknown protection means controls stay enabled; the backend still enforces.
        console.warn('[operator] could not read /admin/session; leaving controls enabled', err);
      }
    });
    return () => { cancelled = true; };
  }, []);

  /** Verify a token with the backend and keep it only if accepted. */
  const login = useCallback(async (candidate) => {
    const value = String(candidate || '').trim();
    if (!value) return { ok: false, error: 'Enter the operator token' };
    try {
      const res = await probeSession(value);
      if (!res.writeProtected) {
        return { ok: false, error: 'This server does not require an operator token' };
      }
      if (!res.authenticated) return { ok: false, error: 'Token rejected' };
      setToken(value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message?.includes('429')
        ? 'Too many attempts — try again shortly'
        : 'Could not reach the backend' };
    }
  }, []);

  const logout = useCallback(() => clearToken(), []);

  // Ready-made tooltip for write controls: null when writing is allowed, so callers can
  // write `title={writeBlockedTitle || 'Normal tooltip'}`.
  const writeBlockedTitle = state.canWrite ? null : 'Operator login required';

  return { ...state, writeBlockedTitle, login, logout };
}
