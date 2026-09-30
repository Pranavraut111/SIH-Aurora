/* ═══════════════════════════════════════════════════════════════
   Aurora — WebSocket Hook (Station-Aware, Offline-Resilient)
   Handles real-time telemetry, manual link-loss simulation,
   local caching, and offline queue aggregation.
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  startSimulation,
  stopSimulation,
  subscribe as subscribeSim,
  getSnapshot,
  getActiveAlerts,
} from '../data/stationData';
import { analyzeStation } from '../services/decisionEngine';
import { WS_URL } from '../config';
import { apiGet, apiPost } from '../services/api';
const RECONNECT_DELAY = 3000;

export function useStationData(activeStation = 'maitri') {
  const [stationData, setStationData] = useState({
    sensors: {},
    alerts: {},
    history: {},
    activeAlerts: [],
    incidents: [],
    eventTimeline: [],
    timestamp: Date.now(),
    connected: true,
    bandwidth: { rawBytes: 1420, compressedBytes: 420, savedKB: 24.8 },
    signalQuality: 100,
    activePatterns: [],
    offlineQueueSize: 0,
    isCached: false,
  });

  const [dataSource, setDataSource] = useState('connecting');
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
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
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to backend');
        setDataSource('websocket');
        stopSimulation();

        // Poll AI analysis for active station
        const aiPollId = setInterval(async () => {
          if (isManuallyDisconnectedRef.current) return;
          const sid = activeStationRef.current;
          try {
            const ai = await apiGet(`/ai/analysis?stationId=${sid}`);
            setStationData(prev => ({
              ...prev,
              aiHealth: ai?.overallHealth || 'healthy',
              dependencyAlerts: ai?.dependencyAlerts || [],
            }));
          } catch (e) { /* AI service optional */ }
        }, 4000);
        ws._aiPollId = aiPollId;
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
          const incidents = analyzeStation(
            activeStationRef.current,
            state.sensors || {},
            state.alerts || {},
          );

          setStationData({
            sensors: state.sensors || {},
            alerts: state.alerts || {},
            history,
            activeAlerts: state.activeAlerts || [],
            incidents,
            eventTimeline: state.eventTimeline || [],
            timestamp: state.timestamp || Date.now(),
            connected: true,
            bandwidth: state.bandwidth || { rawBytes: 1420, compressedBytes: 420, savedKB: 24.8 },
            signalQuality: state.signalQuality ?? 100,
            activePatterns: state.activePatterns || [],
            offlineQueueSize: 0,
            isCached: false,
          });
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, falling back to local cache/simulation');
        if (wsRef.current?._aiPollId) clearInterval(wsRef.current._aiPollId);
        wsRef.current = null;
        if (!isManuallyDisconnectedRef.current) {
          fallbackToSimulation();
          reconnectTimer.current = setTimeout(connectWebSocket, RECONNECT_DELAY);
        }
      };

      ws.onerror = () => {
        console.log('[WS] Error on WebSocket channel');
        ws.close();
      };
    } catch (e) {
      console.log('WebSocket connection failed, using local simulation');
      fallbackToSimulation();
      reconnectTimer.current = setTimeout(connectWebSocket, RECONNECT_DELAY);
    }
  }, [updateHistory]);

  // ── Fall back to local simulation ─────────────────────────
  const fallbackToSimulation = useCallback(() => {
    setDataSource('simulation');
    startSimulation(2000);

    const unsub = subscribeSim(() => {
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
      const incidents = analyzeStation(sid, snapshot.sensors, snapshot.alerts);

      setStationData({
        sensors: snapshot.sensors,
        alerts: snapshot.alerts,
        history,
        activeAlerts: alerts,
        incidents,
        eventTimeline: snapshot.eventTimeline || [],
        timestamp: snapshot.timestamp,
        connected: true,
        bandwidth: computeBandwidth(snapshot),
        signalQuality: snapshot.signalQuality ?? 100,
        activePatterns: snapshot.activePatterns || [],
        offlineQueueSize: 0,
        isCached: false,
      });
    });

    window.__auroraSimUnsub = unsub;
  }, [updateHistory]);

  function computeBandwidth(snapshot) {
    const raw = JSON.stringify(snapshot.sensors);
    const rawBytes = raw.length;
    const compressionRatio = 0.3 + Math.random() * 0.1;
    const compressedBytes = Math.round(rawBytes * compressionRatio);
    const savedKB = ((rawBytes - compressedBytes) / 1024).toFixed(1);
    return { rawBytes, compressedBytes, savedKB: parseFloat(savedKB) };
  }

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
      // Transition to ONLINE / RESTORED
      const savedIncrement = (offlineQueueRef.current * 1.4);
      offlineQueueRef.current = 0;
      setStationData(prev => ({
        ...prev,
        connected: true,
        signalQuality: 100,
        isCached: false,
        offlineQueueSize: 0,
        bandwidth: {
          ...prev.bandwidth,
          savedKB: parseFloat((prev.bandwidth.savedKB + savedIncrement).toFixed(1))
        }
      }));
    }

    // Inform backend if running
    try {
      await apiPost(`/connection/toggle?stationId=${activeStationRef.current}`);
    } catch (e) {
      /* Handled gracefully */
    }
  }, [stationData.connected]);

  const acknowledgeAlert = useCallback(async (alertId) => {
    try {
      await apiPost(`/alerts/${alertId}/acknowledge`);
      setStationData(prev => ({
        ...prev,
        activeAlerts: prev.activeAlerts.filter(a => a.id !== alertId)
      }));
    } catch (e) {
      setStationData(prev => ({
        ...prev,
        activeAlerts: prev.activeAlerts.filter(a => a.id !== alertId)
      }));
    }
  }, []);

  // ── Lifecycle ─────────────────────────────────────────────
  useEffect(() => {
    connectWebSocket();

    const fallbackTimer = setTimeout(() => {
      if (dataSource === 'connecting') {
        fallbackToSimulation();
      }
    }, 2000);

    return () => {
      clearTimeout(fallbackTimer);
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      stopSimulation();
      if (window.__auroraSimUnsub) {
        window.__auroraSimUnsub();
        delete window.__auroraSimUnsub;
      }
    };
  }, []);

  // When station changes, reset history
  useEffect(() => {
    historyRef.current = {};
  }, [activeStation]);

  return {
    stationData,
    dataSource,
    toggleConnection,
    acknowledgeAlert,
  };
}
