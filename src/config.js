/* ═══════════════════════════════════════════════════════════════
   Aurora — frontend configuration (P1-1)
   The ONLY place in src/ that knows backend addresses.
   Values come from Vite env vars (root .env, see .env.example):

     VITE_API_URL  backend base. Absolute ("http://localhost:8080") or
                   relative for a reverse-proxied deployment ("/api" or "").
     VITE_WS_URL   station WebSocket. Absolute ("ws://…", "wss://…",
                   "http(s)://…") or relative ("/ws/station"); relative
                   paths are resolved against window.location (ws/wss).
   The browser never calls the simulator (:8001) directly; everything goes
   through the unified backend (see CLAUDE.md).
   ═══════════════════════════════════════════════════════════════ */

const env = import.meta.env;

const DEFAULTS = {
  API_URL: 'http://localhost:8080',
  WS_URL: 'ws://localhost:8080/ws/station',
};

function stripTrailingSlash(url) {
  return url.length > 1 ? url.replace(/\/+$/, '') : url;
}

function pick(value, fallback) {
  return value === undefined || value === null ? fallback : String(value).trim();
}

/** Backend base URL without a trailing slash ('' = same origin). */
export const API_URL = stripTrailingSlash(pick(env.VITE_API_URL, DEFAULTS.API_URL));

/**
 * Prefix for REST endpoints. Backend routes live under /api, so a base of
 * "http://localhost:8080" or "" becomes ".../api", while a base that already
 * ends in /api (e.g. a proxy mounted at "/api") is used as-is.
 */
export const API_PREFIX = /\/api$/.test(API_URL) ? API_URL : `${API_URL}/api`;

/** Resolve the WebSocket URL, deriving ws/wss from window.location for relative paths. */
export function resolveWsUrl(raw = pick(env.VITE_WS_URL, DEFAULTS.WS_URL)) {
  if (/^wss?:\/\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/^http/i, 'ws');
  if (typeof window === 'undefined' || !window.location) return raw;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return `${proto}//${window.location.host}${path}`;
}

export const WS_URL = resolveWsUrl();
