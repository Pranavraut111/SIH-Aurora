/* ═══════════════════════════════════════════════════════════════
   Aurora — WebSocket Hook (Station-Aware, Offline-Resilient)
   Handles real-time telemetry, manual link-loss simulation,
   local caching, and offline queue aggregation.
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_URL } from '../config';
import { apiPost, describeApiError } from '../services/api';
import { getOperatorName } from '../services/operator';

// The browser-demo generator is only needed when the backend is unreachable, so it is
// loaded then (keeps it out of the startup bundle).
let demoModule = null;
const loadBrowserDemo = () => import('../data/stationData').then((m) => { demoModule = m; return m; });

// WS reconnect: exponential backoff 1 s → 30 s, reset when a socket opens (B21).
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
export const reconnectDelay = (attempt) => Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);

// Per-station stream: the backend sends only this station's snapshots.
function stationWsUrl(stationId) {
  const sep = WS_URL.includes('?') ? '&' : '?';
  return `${WS_URL}${sep}stationId=${encodeURIComponent(stationId)}`;
}

export function useStationData(activeStation = 'maitri') {
  const [stationData, setStationData] = useState({
    sensors: {},
    alerts: {},
    history: {},
    activeAlerts: [],
    eventTimeline: [],
    timestamp: Date.now(),
    energy: null,             // physics energy breakdown of the same tick as `sensors`
    connected: true,
    bandwidth: null,          // not measured — never fabricated
    signalQuality: null,      // not measured
    activePatterns: [],
    offlineQueueSize: 0,
    isCached: false,
    telemetrySource: null,
  });

  const [dataSource, setDataSourceState] = useState('connecting');
  // Ref mirror so timers/callbacks never read a stale closure value (B21).
  const dataSourceRef = useRef('connecting');
  const setDataSource = useCallback((v) => { dataSourceRef.current = v; setDataSourceState(v); }, []);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectAttempt = useRef(0);
  const simUnsubRef = useRef(null);   // the ONE browser-demo subscription (B20)
  const historyRef = useRef({});
  const activeStationRef = useRef(activeStation);
  const isManuallyDisconnectedRef = useRef(false);
  const offlineQueueRef = useRef(0);

  // Keep station ref updated
  useEffect(() => {
    activeStationRef.current = activeStation;
  }, [activeStation]);

  // ── Build history from incoming data ────────────────────────
  const updateHistory = useCallback((sensors) => {
    const now = Date.now();
    const history = historyRef.current;

    Object.entries(sensors).forEach(([buildingId, sensorMap]) => {
      if (!history[buildingId]) history[buildingId] = {};
      Object.entries(sensorMap).forEach(([sensorId, value]) => {
        if (!history[buildingId][sensorId]) history[buildingId][sensorId] = [];
        history[buildingId][sensorId].push({ time: now, value });
        if (history[buildingId][sensorId].length > 60) {
          history[buildingId][sensorId].shift();
        }
      });
    });

    return { ...history };
  }, []);

  // ── Connect to WebSocket ──────────────────────────────────
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(stationWsUrl(activeStationRef.current));
      ws._station = activeStationRef.current; // which station this stream is subscribed to
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to backend');
        reconnectAttempt.current = 0;
        setDataSource('websocket');
        stopBrowserDemo();

      };

      ws.onmessage = (event) => {
        try {
          const state = JSON.parse(event.data);

          // Only process messages for the active station
          if (state.stationId && state.stationId !== activeStationRef.current) {
            return;
          }

          // If link is simulated as LOST, queue readings and do not overwrite with live data
          if (isManuallyDisconnectedRef.current) {
            offlineQueueRef.current += 1;
            setStationData(prev => ({
              ...prev,
              connected: false,
              signalQuality: 0,
              isCached: true,
              offlineQueueSize: offlineQueueRef.current,
            }));
            return;
          }

          const history = updateHistory(state.sensors || {});

          setStationData({
            sensors: state.sensors || {},
            alerts: state.alerts || {},
            history,
            activeAlerts: state.activeAlerts || [],
            eventTimeline: state.eventTimeline || [],
            timestamp: state.timestamp || Date.now(),
            energy: state.energy ?? null,
            connected: true,
            bandwidth: state.bandwidth ?? null,
            signalQuality: state.signalQuality ?? null,
            activePatterns: state.activePatterns || [],
            offlineQueueSize: 0,
            isCached: false,
            // Backend telemetry source + provenance ("simulator" | "physics-fallback")
            telemetrySource: state.dataSource ?? null,
            provenance: state.provenance ?? null,
            // Cascade alerts + health now arrive on every WS message; without these the
            // 2 s WS update wiped the values set by the 4 s /ai/analysis poll.
            dependencyAlerts: state.dependencyAlerts || [],
            aiHealth: state.aiHealth || 'healthy',
          });
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = () => {
        // Use THIS socket (not wsRef): on a station switch wsRef already holds the new socket.
        if (wsRef.current === ws) wsRef.current = null;
        if (ws._switching) {
          console.log('[WS] Closed previous station stream (station switch)');
          return; // a new socket is already connecting; no fallback, no retry
        }
        if (ws._disposed) return; // hook unmounted
        if (!isManuallyDisconnectedRef.current) {
          fallbackToSimulation();
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        console.log('[WS] Error on WebSocket channel');
        ws.close();
      };
    } catch (e) {
      console.warn('[WS] Connection failed, using browser demo mode', e);
      fallbackToSimulation();
      scheduleReconnect();
    }
  }, [updateHistory]);

  function scheduleReconnect() {
    clearTimeout(reconnectTimer.current);
    const delay = reconnectDelay(reconnectAttempt.current);
    reconnectAttempt.current += 1;
    console.log(`[WS] Disconnected; retry in ${delay / 1000}s (browser demo mode meanwhile)`);
    reconnectTimer.current = setTimeout(() => connectWebSocketRef.current(), delay);
  }
  const connectWebSocketRef = useRef(connectWebSocket);
  connectWebSocketRef.current = connectWebSocket;

  function stopBrowserDemo() {
    if (simUnsubRef.current) {
      simUnsubRef.current();
      simUnsubRef.current = null;
    }
    demoModule?.stopSimulation();
  }

  // ── Fall back to local simulation ─────────────────────────
  // Browser demo mode: client-side random-walk data, clearly labelled SIMULATED.
  const fallbackToSimulation = useCallback(() => {
    setDataSource('simulation');
    if (simUnsubRef.current) return; // already subscribed — never stack subscriptions (B20)
    // Placeholder subscription while the generator loads, so a second fallback is a no-op.
    simUnsubRef.current = () => {};
    loadBrowserDemo().then(({ startSimulation, subscribe: subscribeSim, getSnapshot, getActiveAlerts }) => {
      // A socket opened (or the hook unmounted) while the module loaded: stay off.
      if (dataSourceRef.current !== 'simulation' || !simUnsubRef.current) return;
      startSimulation(2000);

      simUnsubRef.current = subscribeSim(() => {
        if (isManuallyDisconnectedRef.current) {
          offlineQueueRef.current += 1;
          setStationData(prev => ({
            ...prev,
            connected: false,
            signalQuality: 0,
            isCached: true,
            offlineQueueSize: offlineQueueRef.current,
          }));
          return;
        }

        const sid = activeStationRef.current;
        const snapshot = getSnapshot(sid);
        const history = updateHistory(snapshot.sensors);
        const alerts = getActiveAlerts(snapshot);

        setStationData({
          sensors: snapshot.sensors,
          alerts: snapshot.alerts,
          history,
          activeAlerts: alerts,
          eventTimeline: snapshot.eventTimeline || [],
          timestamp: snapshot.timestamp,
          connected: true,
          bandwidth: null,
          signalQuality: null,
          activePatterns: snapshot.activePatterns || [],
          offlineQueueSize: 0,
          isCached: false,
          telemetrySource: 'browser-demo',
          energy: null,
          provenance: { equipment: 'SIMULATED', environment: 'SIMULATED', storage: 'SIMULATED' },
        });
      });
    }).catch((err) => {
      console.error('[Demo] could not load the browser demo generator', err);
      simUnsubRef.current = null;       // allow the next fallback to try again
    });
  }, [updateHistory, setDataSource]);

  // ── Link Toggle Handler ───────────────────────────────────
  const toggleConnection = useCallback(async () => {
    const nextState = !stationData.connected;
    isManuallyDisconnectedRef.current = !nextState;

    if (!nextState) {
      // Transition to OFFLINE / LINK LOST
      offlineQueueRef.current = 1;
      setStationData(prev => ({
        ...prev,
        connected: false,
        signalQuality: 0,
        isCached: true,
        offlineQueueSize: 1,
      }));
    } else {
      // Transition to ONLINE / RESTORED (the missed messages were dropped, not stored)
      offlineQueueRef.current = 0;
      setStationData(prev => ({
        ...prev,
        connected: true,
        isCached: false,
        offlineQueueSize: 0,
      }));
    }

    // Inform backend if running
    try {
      await apiPost(`/connection/toggle?stationId=${activeStationRef.current}`);
    } catch (e) {
      console.warn('[Link] backend toggle failed (UI-only link simulation)', e);
    }
  }, [stationData.connected]);

  // Real acknowledge: recorded in the backend (who/when) and persisted. The alert
  // stays visible (marked acknowledged) until its condition clears and it auto-resolves.
  // Returns {ok, error}. Browser-demo alerts have no backend id and cannot be acknowledged.
  const acknowledgeAlert = useCallback(async (alertId) => {
    try {
      const res = await apiPost(`/alerts/${encodeURIComponent(alertId)}/acknowledge`, { acknowledgedBy: getOperatorName() });
      setStationData(prev => ({
        ...prev,
        activeAlerts: prev.activeAlerts.map(a => (a.id === alertId
          ? { ...a, acknowledged: true, status: res.alertStatus, acknowledgedBy: res.acknowledgedBy, acknowledgedAt: res.acknowledgedAt }
          : a)),
      }));
      return { ok: true };
    } catch (e) {
      console.error(`[Alerts] acknowledge ${alertId} failed`, e);
      return { ok: false, error: describeApiError(e) };
    }
  }, []);

  // ── Lifecycle ─────────────────────────────────────────────
  useEffect(() => {
    connectWebSocket();

    const fallbackTimer = setTimeout(() => {
      if (dataSourceRef.current === 'connecting') {
        fallbackToSimulation();
      }
    }, 2000);

    return () => {
      clearTimeout(fallbackTimer);
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current._disposed = true;
        wsRef.current.close();
        wsRef.current = null;
      }
      stopBrowserDemo();
    };
  }, []);

  // When station changes: reset history and re-subscribe the WS to the new station.
  // Compare against the socket's own station (not a "first run" flag) so React
  // StrictMode's dev double-mount doesn't trigger a spurious reconnect.
  useEffect(() => {
    historyRef.current = {};
    const old = wsRef.current;
    if (old && old._station !== activeStation && !isManuallyDisconnectedRef.current) {
      old._switching = true;
      old.close();
      wsRef.current = null;
      clearTimeout(reconnectTimer.current);
      connectWebSocket();
    }
  }, [activeStation, connectWebSocket]);

  return {
    stationData,
    dataSource,
    toggleConnection,
    acknowledgeAlert,
  };
}
