/* src/services/api.js — the one fetch wrapper. It must throw a typed ApiError and
   never hand callers fake data (CLAUDE.md: honesty / provenance). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, apiPost, describeApiError, isAuthError, isRateLimited, request } from './api';
import { API_PREFIX } from '../config';
import { clearToken, getToken, setToken } from './adminToken';

const URL = 'http://backend.test/api/health';

function jsonResponse(body, { status = 200, ok = status < 400 } = {}) {
  return { ok, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('JSON parsing', () => {
  it('returns the parsed body on 200', async () => {
    fetch.mockResolvedValue(jsonResponse({ status: 'ok', stations: ['maitri'] }));
    await expect(request(URL)).resolves.toEqual({ status: 'ok', stations: ['maitri'] });
  });

  it('returns null for an empty 200 body', async () => {
    fetch.mockResolvedValue(jsonResponse(''));
    await expect(request(URL)).resolves.toBeNull();
  });

  it('throws kind "parse" when a 200 body is not JSON', async () => {
    fetch.mockResolvedValue(jsonResponse('<html>nope</html>'));
    const err = await request(URL).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('parse');
    expect(err.body).toBe('<html>nope</html>');
  });
});

describe('non-2xx responses', () => {
  it('throws kind "http" carrying the status and parsed detail', async () => {
    fetch.mockResolvedValue(jsonResponse({ detail: 'Unknown station' }, { status: 404 }));
    const err = await request(URL).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('ApiError');
    expect(err.kind).toBe('http');
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ detail: 'Unknown station' });
    expect(err.url).toBe(URL);
  });

  it('keeps a non-JSON error body as text instead of throwing "parse"', async () => {
    fetch.mockResolvedValue(jsonResponse('Bad Gateway', { status: 502 }));
    const err = await request(URL).catch((e) => e);
    expect(err.kind).toBe('http');
    expect(err.body).toBe('Bad Gateway');
  });

  it('never resolves with fallback data on failure', async () => {
    fetch.mockResolvedValue(jsonResponse({ detail: 'boom' }, { status: 500 }));
    await expect(request(URL)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('timeout and network failure', () => {
  it('aborts the request once timeoutMs elapses and throws kind "timeout"', async () => {
    vi.useFakeTimers();
    let signal;
    fetch.mockImplementation((_url, init) => {
      signal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    // Attach the handler up front: the rejection arrives while the timers advance.
    const pending = request(URL, { timeoutMs: 5000 }).catch((e) => e);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);

    const err = await pending;
    expect(signal.aborted).toBe(true);
    expect(err.kind).toBe('timeout');
    expect(err.message).toContain('5000 ms');
  });

  it('does not abort a request that answers before the timeout', async () => {
    vi.useFakeTimers();
    fetch.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(request(URL, { timeoutMs: 5000 })).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(10_000);   // the timer must already be cleared
  });

  it('throws kind "network" when fetch itself rejects', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await request(URL).catch((e) => e);
    expect(err.kind).toBe('network');
    expect(err.cause).toBeInstanceOf(TypeError);
  });
});

describe('apiGet / apiPost', () => {
  it('prefixes relative paths with API_PREFIX and sends no body on GET', async () => {
    fetch.mockResolvedValue(jsonResponse({}));
    await apiGet('/health');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${API_PREFIX}/health`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('accepts a path without a leading slash', async () => {
    fetch.mockResolvedValue(jsonResponse({}));
    await apiGet('health');
    expect(fetch.mock.calls[0][0]).toBe(`${API_PREFIX}/health`);
  });

  it('leaves an absolute URL untouched', async () => {
    fetch.mockResolvedValue(jsonResponse({}));
    await apiGet('https://elsewhere.test/api/health');
    expect(fetch.mock.calls[0][0]).toBe('https://elsewhere.test/api/health');
  });

  it('JSON-encodes the POST body and sets the content type', async () => {
    fetch.mockResolvedValue(jsonResponse({ status: 'saved' }));
    await apiPost('/admin/config', { stationId: 'maitri' });
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ stationId: 'maitri' });
  });
});

describe('describeApiError', () => {
  it('flattens a FastAPI 422 detail list', () => {
    const err = new ApiError('x', {
      kind: 'http',
      status: 422,
      body: { detail: [{ loc: ['body', 'intensity'], msg: 'must be <= 2' }] },
    });
    expect(describeApiError(err)).toBe('intensity: must be <= 2');
  });

  it('passes a string detail through, and names timeouts and network errors', () => {
    expect(describeApiError(new ApiError('x', { kind: 'http', status: 404, body: { detail: 'Unknown station' } })))
      .toBe('Unknown station');
    expect(describeApiError(new ApiError('x', { kind: 'timeout' }))).toBe('request timed out');
    expect(describeApiError(new ApiError('x', { kind: 'network' }))).toBe('backend unreachable');
    expect(describeApiError(null)).toBe('');
  });
});


// ── Operator token ──────────────────────────────────────────────────────────
describe('the operator token', () => {
  afterEach(() => clearToken());

  it('is not sent when nobody is logged in', async () => {
    fetch.mockResolvedValue(jsonResponse({}));
    await apiPost('/sim/reset', {});
    expect(fetch.mock.calls[0][1].headers['X-Admin-Token']).toBeUndefined();
  });

  it('is sent on writes once set', async () => {
    setToken('tok-123');
    fetch.mockResolvedValue(jsonResponse({}));
    await apiPost('/sim/reset', {});
    expect(fetch.mock.calls[0][1].headers['X-Admin-Token']).toBe('tok-123');
  });

  it('is sent on reads too, which is what the session probe relies on', async () => {
    setToken('tok-123');
    fetch.mockResolvedValue(jsonResponse({}));
    await apiGet('/admin/session');
    expect(fetch.mock.calls[0][1].headers['X-Admin-Token']).toBe('tok-123');
  });

  it('does not override a token passed explicitly for one call', async () => {
    setToken('tok-123');
    fetch.mockResolvedValue(jsonResponse({}));
    await apiGet('/admin/session', { headers: { 'X-Admin-Token': 'candidate' } });
    expect(fetch.mock.calls[0][1].headers['X-Admin-Token']).toBe('candidate');
  });

  it('is dropped when the server answers 401, so the UI stops claiming to be logged in', async () => {
    setToken('stale');
    fetch.mockResolvedValue(jsonResponse({ detail: 'Operator login required' }, { status: 401 }));
    const err = await apiPost('/sim/reset', {}).catch((e) => e);
    expect(isAuthError(err)).toBe(true);
    expect(getToken()).toBeNull();
  });

  it('is kept on other failures — a 503 is not a bad token', async () => {
    setToken('good');
    fetch.mockResolvedValue(jsonResponse({ detail: 'Simulator offline' }, { status: 503 }));
    await expect(apiPost('/sim/reset', {})).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBe('good');
  });
});

describe('401 / 429 / 413 messages', () => {
  it('names the login requirement on 401', () => {
    const err = new ApiError('x', { kind: 'http', status: 401, body: { detail: 'nope' } });
    expect(isAuthError(err)).toBe(true);
    expect(describeApiError(err)).toBe('Operator login required for this action');
  });

  it('passes nginx\'s friendly 429 message through', () => {
    const err = new ApiError('x', {
      kind: 'http', status: 429,
      body: { detail: 'Too many requests — please slow down and try again in a few seconds.' },
    });
    expect(isRateLimited(err)).toBe(true);
    expect(describeApiError(err)).toContain('slow down');
  });

  it('falls back to a readable message when a 429 has no body', () => {
    const err = new ApiError('x', { kind: 'http', status: 429, body: null });
    expect(describeApiError(err)).toContain('Too many requests');
  });

  it('explains a 413', () => {
    const err = new ApiError('x', { kind: 'http', status: 413, body: { detail: 'Request body too large (limit 64 kB).' } });
    expect(describeApiError(err)).toContain('too large');
  });

  it('does not mistake other statuses for auth or rate-limit errors', () => {
    const err = new ApiError('x', { kind: 'http', status: 500, body: null });
    expect(isAuthError(err)).toBe(false);
    expect(isRateLimited(err)).toBe(false);
    expect(isAuthError(null)).toBe(false);
    expect(isRateLimited(new ApiError('x', { kind: 'timeout' }))).toBe(false);
  });
});
