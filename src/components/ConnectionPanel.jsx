/* ═══════════════════════════════════════════════════════════════
   Aurora — Connection Status Drawer (Mission Control)
   Satellite link telemetry, bandwidth reduction bar, offline queue.
   Slide-in contextual drawer from right with backdrop support.
   ═══════════════════════════════════════════════════════════════ */
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuSatelliteDish,
  LuUnplug,
  LuPlug,
  LuServer,
  LuCircleDot,
  LuX,
  LuActivity,
  LuWifi,
  LuWifiOff,
  LuHardDrive,
} from 'react-icons/lu';
import './ConnectionPanel.css';

export default function ConnectionPanel({
  isOpen = true,
  onClose,
  isConnected,
  onToggleConnection,
  bandwidthSaved = 0,
  offlineQueueSize = 0,
  dataSource = 'simulation',
  signalQuality = 'good',
  bandwidth,
}) {
  const rawKB = bandwidthSaved * 3.2;
  const compressedKB = rawKB - bandwidthSaved;
  const savingsPercent = rawKB > 0 ? ((bandwidthSaved / rawKB) * 100).toFixed(0) : 0;

  const sourceLabels = {
    websocket: { label: 'Live Backend (FastAPI)', color: '#34d399' },
    simulation: { label: 'Local Polar Ingestion', color: '#fbbf24' },
    default: { label: 'Connecting...', color: 'var(--text-muted)' },
  };
  const src = sourceLabels[dataSource] || sourceLabels.default;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          {onClose && (
            <motion.div
              className="conn-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
          )}

          {/* Drawer Panel */}
          <motion.div
            className="conn-drawer glass-panel"
            initial={{ opacity: 0, x: 380 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 380 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Header */}
            <div className="conn-header">
              <div className="conn-header-left">
                <LuSatelliteDish size={18} className="conn-icon" />
                <h3 className="conn-title font-display">Satellite Link & Telemetry</h3>
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

            {/* Status Banner */}
            <div className={`conn-status-card ${isConnected ? 'online' : 'offline'}`}>
              <div className="conn-status-title-row">
                {isConnected ? <LuWifi size={16} /> : <LuWifiOff size={16} />}
                <span className="conn-status-label font-mono">
                  {isConnected ? 'IRIDIUM SBD LINK ACTIVE' : 'SAT-LINK LOST / OFFLINE'}
                </span>
              </div>
              <div className="conn-status-detail">
                {isConnected
                  ? 'Real-time delta-encoded observation sync over 2.4 kbps polar satellite link.'
                  : `Station in autonomous isolation. ${offlineQueueSize} observation deltas queued in local SQLite storage.`}
              </div>
            </div>

            {/* Link Telemetry Metrics */}
            <div className="conn-metrics-grid">
              <div className="conn-metric-box">
                <span className="conn-metric-label">Signal Quality</span>
                <span className={`conn-metric-val font-mono ${isConnected ? 'text-success' : 'text-danger'}`}>
                  {isConnected ? (signalQuality === 'good' ? '98% (Nominal)' : '72% (Degraded)') : '0% (No Carrier)'}
                </span>
              </div>
              <div className="conn-metric-box">
                <span className="conn-metric-label">Uplink Latency</span>
                <span className="conn-metric-val font-mono">
                  {isConnected ? '1,420 ms' : 'Infinity'}
                </span>
              </div>
            </div>

            {/* Bandwidth Savings Section */}
            <div className="conn-bw-section">
              <h4 className="conn-section-title text-label">Bandwidth Optimization (Delta-Encoding)</h4>

              <div className="conn-bw-bar-container">
                <div className="conn-bw-bar">
                  <motion.div
                    className="conn-bw-fill raw"
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 0.8 }}
                  />
                  <motion.div
                    className="conn-bw-fill compressed"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(100 - Number(savingsPercent), 15)}%` }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                  />
                  <div className="conn-bw-shimmer" />
                </div>
                <div className="conn-bw-labels">
                  <span className="conn-bw-label raw-label">Raw JSON Stream</span>
                  <span className="conn-bw-label comp-label">Polar Delta-Compressed</span>
                </div>
              </div>

              <div className="conn-bw-stats">
                <div className="conn-stat">
                  <span className="conn-stat-value font-mono tabular-nums">{rawKB.toFixed(1)}</span>
                  <span className="conn-stat-unit text-label">KB Raw</span>
                </div>
                <div className="conn-stat">
                  <span className="conn-stat-value font-mono tabular-nums">{compressedKB.toFixed(1)}</span>
                  <span className="conn-stat-unit text-label">KB Sent</span>
                </div>
                <div className="conn-stat highlight">
                  <span className="conn-stat-value font-mono tabular-nums">{bandwidthSaved.toFixed(1)}</span>
                  <span className="conn-stat-unit text-label">KB Saved</span>
                </div>
                <div className="conn-stat">
                  <span className="conn-stat-value font-mono tabular-nums">{savingsPercent}%</span>
                  <span className="conn-stat-unit text-label">Reduction</span>
                </div>
              </div>
            </div>

            {/* Data Source */}
            <div className="conn-source">
              <span className="conn-source-label text-label">Telemetry Ingestion Engine:</span>
              <span className="conn-source-badge" style={{ color: src.color }}>
                <LuCircleDot size={10} strokeWidth={2} /> {src.label}
              </span>
            </div>

            {/* Simulate Link Loss / Restore Action */}
            <div className="conn-action-section">
              <button
                className={`conn-toggle-btn ${isConnected ? 'disconnect' : 'reconnect'}`}
                onClick={onToggleConnection}
              >
                {isConnected ? (
                  <>
                    <LuUnplug size={16} /> Simulate Satellite Link Loss
                  </>
                ) : (
                  <>
                    <LuPlug size={16} /> Restore Satellite Connection
                  </>
                )}
              </button>
            </div>

            {/* Offline Storage Queue Card */}
            {!isConnected && (
              <motion.div
                className="conn-queue-card"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="conn-queue-header">
                  <LuHardDrive size={15} className="queue-icon" />
                  <span className="conn-queue-title font-mono">EDGE BUFFER STATUS</span>
                </div>
                <div className="conn-queue-detail">
                  <span className="conn-queue-count font-mono tabular-nums">{offlineQueueSize}</span>
                  <span className="conn-queue-unit"> observations buffered locally</span>
                </div>
                <p className="conn-queue-info">
                  Automatic failover active. SQLite edge buffer will burst-upload telemetry packet upon Iridium signal re-acquisition.
                </p>
              </motion.div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
