/* ═══════════════════════════════════════════════════════════════
   Aurora — minimal fetch wrapper (P1-1)
   - Base URLs come from src/config.js (never hardcoded here).
   - Timeout via AbortController.
   - Parses JSON responses.
   - THROWS ApiError on non-2xx, timeout, network failure or bad JSON.
     It NEVER returns fake/fallback data — callers decide what to show.
   ═══════════════════════════════════════════════════════════════ */
import { API_PREFIX } from '../config';

const DEFAULT_TIMEOUT_MS = 10_000;

/** kind: 'http' | 'timeout' | 'network' | 'parse' */
export class ApiError extends Error {
  constructor(message, { kind, status = null, url, body = null, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.url = url;
    this.body = body;
    if (cause) this.cause = cause;
  }
}

function joinUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * @param {string} url absolute URL (use the apiGet/apiPost helpers for base handling)
 * @param {{method?: string, body?: any, timeoutMs?: number, headers?: object}} opts
 */
export async function request(url, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = { method, headers: { ...headers }, signal: controller.signal };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new ApiError(`Request timed out after ${timeoutMs} ms: ${method} ${url}`, { kind: 'timeout', url, cause: err });
    }
    throw new ApiError(`Network error: ${method} ${url} (${err?.message || err})`, { kind: 'network', url, cause: err });
  }
  clearTimeout(timer);

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      if (res.ok) {
        throw new ApiError(`Invalid JSON from ${method} ${url}`, { kind: 'parse', status: res.status, url, body: text, cause: err });
      }
      data = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} from ${method} ${url}`, { kind: 'http', status: res.status, url, body: data });
  }
  return data;
}

// ── Unified backend (REST under /api) ────────────────────────
export const apiGet = (path, opts) => request(joinUrl(API_PREFIX, path), { ...opts, method: 'GET' });
export const apiPost = (path, body, opts) => request(joinUrl(API_PREFIX, path), { ...opts, method: 'POST', body });

/** Human-readable message for an ApiError (FastAPI 422 detail lists, 404/503 detail strings). */
export function describeApiError(err) {
  if (!err) return '';
  if (err.kind === 'http') {
    const detail = err.body?.detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => (typeof d === 'string' ? d : `${(d.loc || []).slice(1).join('.')}: ${d.msg}`)).join('; ');
    }
    if (typeof detail === 'string') return detail;
    return `HTTP ${err.status}`;
  }
  if (err.kind === 'timeout') return 'request timed out';
  return 'backend unreachable';
}
