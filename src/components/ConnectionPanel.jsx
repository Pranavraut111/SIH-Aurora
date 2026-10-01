/* ═══════════════════════════════════════════════════════════════
   Aurora — Connection Status Drawer (Mission Control)
   Telemetry link state and data source. Only real values are shown;
   link loss is a UI simulation and nothing is queued or replayed.
   Slide-in contextual drawer from right with backdrop support.
   ═══════════════════════════════════════════════════════════════ */
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuSatelliteDish,
  LuUnplug,
  LuPlug,
  LuCircleDot,
  LuX,
  LuWifi,
  LuWifiOff,
} from 'react-icons/lu';
import { useAdminToken } from '../hooks/useAdminToken';
import './ConnectionPanel.css';

const SOURCE_LABELS = {
  simulator: { label: 'Live simulator → unified backend (WebSocket)', color: '#34d399' },
  'physics-fallback': { label: 'Physics fallback in backend (simulator offline)', color: '#38bdf8' },
  'browser-demo': { label: 'Browser demo mode — random-walk data, NOT real', color: '#f59e0b' },
  offline: { label: 'Link cut (simulated) — last values frozen', color: '#f87171' },
  connecting: { label: 'Connecting…', color: 'var(--text-muted)' },
};

export default function ConnectionPanel({
  isOpen = true,
  onClose,
  isConnected,
  onToggleConnection,
  offlineQueueSize = 0,
  telemetryBadge = 'connecting',
  provenance,
}) {
  const { canWrite, writeBlockedTitle } = useAdminToken();
  const src = SOURCE_LABELS[telemetryBadge] || SOURCE_LABELS.connecting;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {onClose && (
            <motion.div
              className="conn-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
          )}

          <motion.div
            className="conn-drawer glass-panel"
            initial={{ opacity: 0, x: 380 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 380 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div className="conn-header">
              <div className="conn-header-left">
                <LuSatelliteDish size={18} className="conn-icon" />
                <h3 className="conn-title font-display">Telemetry Link</h3>
              </div>
              <div className="conn-header-right">
                <span className={`conn-status-dot ${isConnected ? 'online' : 'offline'}`} />
                {onClose && (
                  <button className="conn-close-btn" onClick={onClose} title="Close">
                    <LuX size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className={`conn-status-card ${isConnected ? 'online' : 'offline'}`}>
              <div className="conn-status-title-row">
                {isConnected ? <LuWifi size={16} /> : <LuWifiOff size={16} />}
                <span className="conn-status-label font-mono">
                  {isConnected ? 'LINK UP' : 'LINK CUT (SIMULATED)'}
                </span>
              </div>
              <div className="conn-status-detail">
                {isConnected
                  ? 'The dashboard receives one snapshot per station every 2 s from the unified backend over a WebSocket. There is no real satellite link in this prototype.'
                  : `Link loss is simulated in the browser. ${offlineQueueSize} incoming messages were ignored while cut; they are not stored and will not be replayed.`}
              </div>
            </div>

            <div className="conn-metrics-grid">
              <div className="conn-metric-box">
                <span className="conn-metric-label">Signal quality</span>
                <span className="conn-metric-val font-mono text-muted">not measured</span>
              </div>
              <div className="conn-metric-box">
                <span className="conn-metric-label">Latency / bandwidth</span>
                <span className="conn-metric-val font-mono text-muted">not measured</span>
              </div>
            </div>

            <div className="conn-source">
              <span className="conn-source-label text-label">Telemetry source:</span>
              <span className="conn-source-badge" style={{ color: src.color }}>
                <LuCircleDot size={10} strokeWidth={2} /> {src.label}
              </span>
            </div>
            {provenance && (
              <div className="conn-source">
                <span className="conn-source-label text-label">Provenance:</span>
                <span className="conn-source-badge font-mono">
                  equipment {provenance.equipment ?? '—'} · environment {provenance.environment ?? '—'} · storage {provenance.storage ?? '—'}
                </span>
              </div>
            )}

            <div className="conn-action-section">
              <button
                className={`conn-toggle-btn ${isConnected ? 'disconnect' : 'reconnect'}`}
                onClick={onToggleConnection}
                disabled={!canWrite}
                title={writeBlockedTitle || undefined}
              >
                {isConnected ? (
                  <>
                    <LuUnplug size={16} /> Simulate link loss
                  </>
                ) : (
                  <>
                    <LuPlug size={16} /> Restore link
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
