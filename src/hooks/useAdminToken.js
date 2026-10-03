/* ═══════════════════════════════════════════════════════════════
   Aurora — React view of the in-memory operator token.
   Learns from GET /api/admin/session whether the server protects writes at all,
   so local development (no ADMIN_TOKEN) keeps every control enabled.
   ═══════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useState } from 'react';
import {
  canWrite,
  canWriteShared,
  clearToken,
  getJudgeMode,
  getToken,
  getWriteProtection,
  inSandbox,
  setJudgeMode,
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
    canWriteShared: canWriteShared(),
    sandbox: inSandbox(),
    publicDemo: getJudgeMode().publicDemo,
    judge: getJudgeMode(),
  };
}

/** Ask the backend whether writes need a token, and whether `token` is accepted. */
async function probeSession(token) {
  const res = await apiGet('/admin/session', token ? { headers: { 'X-Admin-Token': token } } : undefined);
  setWriteProtected(res.writeProtected);
  setJudgeMode(res);
  return res;
}

// Components that mount together (a page full of WriteButtons) share one in-flight probe.
let sharedProbe = null;
function probeShared() {
  if (!sharedProbe) {
    sharedProbe = probeSession(getToken()).finally(() => { sharedProbe = null; });
  }
  return sharedProbe;
}
const RETRY_MS = 10000;

export function useAdminToken() {
  const [state, setState] = useState(snapshot);

  useEffect(() => subscribe(() => setState(snapshot())), []);

  // Probe on mount so the UI knows whether to disable write controls. If the backend
  // is down, keep asking every 10 s: when it comes back, "Sign in" appears without a reload.
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const attempt = () => {
      probeShared().catch((err) => {
        if (cancelled) return;
        // Unknown protection means controls stay enabled; the backend still enforces.
        console.warn('[operator] could not read /admin/session; leaving controls enabled, retrying', err);
        timer = setTimeout(attempt, RETRY_MS);
      });
    };
    attempt();
    return () => { cancelled = true; clearTimeout(timer); };
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
  const writeBlockedTitle = state.canWrite ? null : 'Team sign-in required';
  const sharedBlockedTitle = state.canWriteShared ? null : 'Team sign-in required: this changes the shared station';

  return { ...state, writeBlockedTitle, sharedBlockedTitle, login, logout };
}
