/* src/config.js — the only file in src/ that knows backend addresses.
   Env vars are read at module load, so each case re-imports the module with
   vi.resetModules() after stubbing import.meta.env and window.location. */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig({ apiUrl, wsUrl, origin } = {}) {
  vi.resetModules();
  if (apiUrl !== undefined) {
    vi.stubEnv('VITE_API_URL', apiUrl);
  } else {
    delete import.meta.env.VITE_API_URL;
  }
  if (wsUrl !== undefined) {
    vi.stubEnv('VITE_WS_URL', wsUrl);
  } else {
    delete import.meta.env.VITE_WS_URL;
  }
  if (origin) {
    const url = new URL(origin);
    vi.stubGlobal('window', { location: { protocol: url.protocol, host: url.host } });
  }
  return import('./config');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('API_URL defaults and normalisation', () => {
  it('falls back to the local backend when VITE_API_URL is unset', async () => {
    const { API_URL, API_PREFIX } = await loadConfig({ apiUrl: undefined });
    expect(API_URL).toBe('http://localhost:8080');
    expect(API_PREFIX).toBe('http://localhost:8080/api');
  });

  it('strips trailing slashes', async () => {
    const { API_URL, API_PREFIX } = await loadConfig({ apiUrl: 'https://aurora.example.org///' });
    expect(API_URL).toBe('https://aurora.example.org');
    expect(API_PREFIX).toBe('https://aurora.example.org/api');
  });

  it('trims surrounding whitespace', async () => {
    const { API_URL } = await loadConfig({ apiUrl: '  http://10.0.0.5:8080  ' });
    expect(API_URL).toBe('http://10.0.0.5:8080');
  });
});

describe('API_PREFIX for relative / reverse-proxied deployments', () => {
  it('treats an empty base as same-origin', async () => {
    const { API_URL, API_PREFIX } = await loadConfig({ apiUrl: '' });
    expect(API_URL).toBe('');
    expect(API_PREFIX).toBe('/api');
  });

  it('does not double up when the base already ends in /api', async () => {
    const { API_PREFIX } = await loadConfig({ apiUrl: '/api' });
    expect(API_PREFIX).toBe('/api');
  });

  it('keeps a mounted sub-path and appends /api once', async () => {
    const { API_PREFIX } = await loadConfig({ apiUrl: '/aurora' });
    expect(API_PREFIX).toBe('/aurora/api');
  });

  it('keeps an absolute base that already ends in /api', async () => {
    const { API_PREFIX } = await loadConfig({ apiUrl: 'https://aurora.example.org/api' });
    expect(API_PREFIX).toBe('https://aurora.example.org/api');
  });
});

describe('WebSocket URL resolution', () => {
  it('defaults to the local backend stream', async () => {
    const { WS_URL } = await loadConfig({ wsUrl: undefined, origin: 'http://localhost:5173' });
    expect(WS_URL).toBe('ws://localhost:8080/ws/station');
  });

  it('passes ws:// and wss:// through untouched', async () => {
    const { resolveWsUrl } = await loadConfig();
    expect(resolveWsUrl('ws://backend:8080/ws/station')).toBe('ws://backend:8080/ws/station');
    expect(resolveWsUrl('wss://aurora.example.org/ws/station')).toBe('wss://aurora.example.org/ws/station');
  });

  it('rewrites an http(s) base to the matching ws scheme', async () => {
    const { resolveWsUrl } = await loadConfig();
    expect(resolveWsUrl('http://backend:8080/ws/station')).toBe('ws://backend:8080/ws/station');
    expect(resolveWsUrl('https://aurora.example.org/ws/station')).toBe('wss://aurora.example.org/ws/station');
  });

  it('derives ws:// from a plain-http page for a relative path', async () => {
    const { WS_URL } = await loadConfig({ wsUrl: '/ws/station', origin: 'http://localhost:5173' });
    expect(WS_URL).toBe('ws://localhost:5173/ws/station');
  });

  it('derives wss:// from an https page for a relative path', async () => {
    const { WS_URL } = await loadConfig({ wsUrl: '/ws/station', origin: 'https://aurora.example.org' });
    expect(WS_URL).toBe('wss://aurora.example.org/ws/station');
  });

  it('adds the missing leading slash on a bare relative path', async () => {
    const { resolveWsUrl } = await loadConfig({ origin: 'https://aurora.example.org:8443' });
    expect(resolveWsUrl('ws/station')).toBe('wss://aurora.example.org:8443/ws/station');
  });

  it('returns the raw value when there is no window (SSR / node)', async () => {
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    const { resolveWsUrl } = await import('./config');
    expect(resolveWsUrl('/ws/station')).toBe('/ws/station');
  });
});
