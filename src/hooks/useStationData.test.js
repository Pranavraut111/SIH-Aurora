/* useStationData — station filtering, dataSource/provenance handling and the
   reconnect backoff (B21). The WebSocket is a stub: no network, no real timers. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/api', () => ({
  apiPost: vi.fn().mockResolvedValue({}),
  describeApiError: (e) => String(e?.message ?? e),
}));
// The browser-demo generator is a labelled fallback, not under test here.
vi.mock('../data/stationData', () => ({
  startSimulation: vi.fn(),
  stopSimulation: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  getSnapshot: () => ({ sensors: {}, alerts: {}, timestamp: 0, eventTimeline: [], activePatterns: [] }),
  getActiveAlerts: () => [],
}));

const { reconnectDelay, useStationData } = await import('./useStationData');

/** Minimal WebSocket stand-in that records every instance it creates. */
class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closeCalls = 0;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(data) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  close() {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const snapshot = (overrides = {}) => ({
  stationId: 'maitri',
  sensors: { generator: { gen_temp: 72 } },
  alerts: { generator: 'normal' },
  activeAlerts: [],
  eventTimeline: [],
  timestamp: 1_700_000_000_000,
  dataSource: 'simulator',
  provenance: { equipment: 'MODEL-DERIVED' },
  ...overrides,
});

const latest = () => FakeWebSocket.instances.at(-1);

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reconnect backoff', () => {
  it('doubles from 1 s and caps at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 99].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('retries on close with a growing delay and resets the delay once a socket opens', async () => {
    vi.useFakeTimers();
    renderHook(() => useStationData('maitri'));
    expect(FakeWebSocket.instances).toHaveLength(1);

    // First drop: retry after 1 s.
    await act(async () => { latest().close(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(FakeWebSocket.instances).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Second drop without an open in between: retry after 2 s, not 1 s.
    await act(async () => { latest().close(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(FakeWebSocket.instances).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(FakeWebSocket.instances).toHaveLength(3);

    // A successful open resets the attempt counter: the next drop retries after 1 s again.
    await act(async () => { latest().open(); });
    await act(async () => { latest().close(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('stops reconnecting after unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useStationData('maitri'));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('subscription URL', () => {
  it('subscribes to the active station only', () => {
    renderHook(() => useStationData('bharati'));
    expect(latest().url).toContain('stationId=bharati');
  });

  it('closes the old stream and opens a new one when the station changes', async () => {
    const { rerender } = renderHook(({ station }) => useStationData(station), {
      initialProps: { station: 'maitri' },
    });
    const first = latest();
    await act(async () => { first.open(); });

    await act(async () => { rerender({ station: 'bharati' }); });
    expect(first.closeCalls).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(latest().url).toContain('stationId=bharati');
  });
});

describe('message handling', () => {
  it('marks the source as websocket and keeps the backend dataSource as provenance', async () => {
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().open(); });
    await act(async () => { latest().send(snapshot()); });

    expect(result.current.dataSource).toBe('websocket');
    expect(result.current.stationData.telemetrySource).toBe('simulator');
    expect(result.current.stationData.provenance).toEqual({ equipment: 'MODEL-DERIVED' });
    expect(result.current.stationData.sensors.generator.gen_temp).toBe(72);
    expect(result.current.stationData.connected).toBe(true);
  });

  it('carries physics-fallback through unchanged', async () => {
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().open(); });
    await act(async () => { latest().send(snapshot({ dataSource: 'physics-fallback' })); });
    expect(result.current.stationData.telemetrySource).toBe('physics-fallback');
  });

  it('never fabricates bandwidth or signal quality', async () => {
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().open(); });
    await act(async () => { latest().send(snapshot()); });
    expect(result.current.stationData.bandwidth).toBeNull();
    expect(result.current.stationData.signalQuality).toBeNull();
  });

  it('ignores a snapshot for a different station', async () => {
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().open(); });
    await act(async () => { latest().send(snapshot()); });
    await act(async () => { latest().send(snapshot({ stationId: 'bharati', sensors: { generator: { gen_temp: 11 } } })); });
    expect(result.current.stationData.sensors.generator.gen_temp).toBe(72);
  });

  it('accepts a snapshot with no stationId (single-station stream)', async () => {
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().open(); });
    await act(async () => { latest().send(snapshot({ stationId: undefined, sensors: { generator: { gen_temp: 55 } } })); });
    expect(result.current.stationData.sensors.generator.gen_temp).toBe(55);
  });

  it('builds per-sensor history across messages', async () => {
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().open(); });
    await act(async () => { latest().send(snapshot()); });
    await act(async () => { latest().send(snapshot({ sensors: { generator: { gen_temp: 75 } }, timestamp: 1_700_000_002_000 })); });
    const series = result.current.stationData.history.generator.gen_temp;
    expect(series.map((p) => p.value)).toEqual([72, 75]);
  });

  it('survives a malformed message without losing the last good state', async () => {
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().open(); });
    await act(async () => { latest().send(snapshot()); });
    await act(async () => { latest().onmessage({ data: 'not json' }); });
    expect(result.current.stationData.sensors.generator.gen_temp).toBe(72);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('simulated satellite link (backend store-and-forward)', () => {
  const down = { up: false, syncing: false, lastContact: 1_700_000_000_000, bufferedReadings: 3, bufferedBytes: 4200 };

  it('shows the backend link state: stale while down, buffer count from the backend', async () => {
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().open(); });
    await act(async () => { latest().send(snapshot()); });
    // While down the backend repeats the last data received (same timestamp) with the live buffer.
    await act(async () => { latest().send(snapshot({ link: down })); });
    expect(result.current.stationData.connected).toBe(false);
    expect(result.current.stationData.isCached).toBe(true);
    expect(result.current.stationData.offlineQueueSize).toBe(3);
    expect(result.current.stationData.link.bufferedBytes).toBe(4200);
    expect(result.current.stationData.history.generator.gen_temp).toHaveLength(1);   // nothing new added

    await act(async () => { latest().send(snapshot({ timestamp: 1_700_000_010_000, link: { ...down, up: true, bufferedReadings: 0 } })); });
    expect(result.current.stationData.connected).toBe(true);
    expect(result.current.stationData.offlineQueueSize).toBe(0);
  });

  it('the team toggle asks the backend; nothing is simulated in the browser', async () => {
    const { apiPost } = await import('../services/api');
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().open(); });
    await act(async () => { await result.current.toggleConnection(); });
    expect(apiPost).toHaveBeenCalledWith('/connection/toggle?stationId=maitri');
    expect(result.current.stationData.connected).toBe(true);           // until the backend says otherwise
  });
});

describe('browser-demo fallback', () => {
  it('labels the source "simulation" when no socket opens within 2 s', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStationData('maitri'));
    expect(result.current.dataSource).toBe('connecting');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.dataSource).toBe('simulation');
  });

  it('falls back immediately when the socket closes before opening', async () => {
    const { result } = renderHook(() => useStationData('maitri'));
    await act(async () => { latest().close(); });
    await waitFor(() => expect(result.current.dataSource).toBe('simulation'));
  });
});
