/* ═══════════════════════════════════════════════════════════════
   Aurora — Alert & Incident Drawer (Mission Control)
   Grouped, deduped alerts and live station anomaly feed.
   Slide-in contextual drawer from right with backdrop support.
   ═══════════════════════════════════════════════════════════════ */
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from './IconMap';
import {
  LuTriangleAlert,
  LuChevronDown,
  LuX,
  LuShieldAlert,
  LuCircleCheck,
  LuActivity,
} from 'react-icons/lu';
import './AlertFeed.css';

export default function AlertFeed({
  isOpen = true,
  onClose,
  alerts = [],
  onAlertClick,
}) {
  const [expanded, setExpanded] = useState(false);

  // Group and dedupe alerts by buildingId + level
  const grouped = useMemo(() => {
    const map = new Map();
    (alerts || []).forEach(alert => {
      const key = `${alert.buildingId}-${alert.level}`;
      if (map.has(key)) {
        const existing = map.get(key);
        existing.count += 1;
        existing.timestamp = Math.max(existing.timestamp || 0, alert.timestamp || 0);
      } else {
        map.set(key, { ...alert, count: 1 });
      }
    });
    const result = Array.from(map.values());
    // Critical pinned on top
    result.sort((a, b) => {
      if (a.level === 'critical' && b.level !== 'critical') return -1;
      if (a.level !== 'critical' && b.level === 'critical') return 1;
      return 0;
    });
    return result;
  }, [alerts]);

  // Relative time
  function relTime(ts) {
    if (!ts) return 'just now';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  const criticalCount = grouped.filter(a => a.level === 'critical').length;
  const warningCount = grouped.filter(a => a.level === 'warning').length;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          {onClose && (
            <motion.div
              className="alert-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
          )}

          {/* Drawer Panel */}
          <motion.div
            className="alert-drawer glass-panel"
            initial={{ opacity: 0, x: 380 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 380 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Header */}
            <div className="alert-drawer-header">
              <div className="alert-drawer-title-wrap">
                <LuTriangleAlert size={18} className="alert-drawer-icon text-warning" />
                <h3 className="alert-drawer-title font-display">Active Station Alerts</h3>
                <span className="alert-count-badge font-mono tabular-nums">{grouped.length}</span>
              </div>
              {onClose && (
                <button className="alert-close-btn" onClick={onClose} title="Close">
                  <LuX size={16} />
                </button>
              )}
            </div>

            {/* Summary KPI Strip */}
            <div className="alert-summary-strip">
              <div className="alert-sum-box">
                <span className="sum-label">Critical</span>
                <span className={`sum-val font-mono ${criticalCount > 0 ? 'text-danger' : 'text-muted'}`}>
                  {criticalCount}
                </span>
              </div>
              <div className="alert-sum-box">
                <span className="sum-label">Warnings</span>
                <span className={`sum-val font-mono ${warningCount > 0 ? 'text-warning' : 'text-muted'}`}>
                  {warningCount}
                </span>
              </div>
              <div className="alert-sum-box">
                <span className="sum-label">Health</span>
                <span className="sum-val font-mono text-success">
                  {criticalCount === 0 ? (warningCount === 0 ? 'NOMINAL' : 'MONITOR') : 'ACTION'}
                </span>
              </div>
            </div>

            {/* Alerts List */}
            <div className="alert-drawer-list">
              {grouped.length === 0 ? (
                <div className="alert-empty-state">
                  <LuCircleCheck size={32} className="empty-icon text-success" />
                  <h4 className="empty-title font-display">All Systems Nominal</h4>
                  <p className="empty-desc">
                    No active threshold violations or anomaly cascades detected across polar facility subsystems.
                  </p>
                </div>
              ) : (
                grouped.map((alert, i) => (
                  <motion.div
                    key={`${alert.buildingId}-${alert.level}-${i}`}
                    className={`alert-card-item ${alert.level}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => {
                      onAlertClick?.(alert.buildingId);
                      onClose?.();
                    }}
                  >
                    <div className="alert-card-top">
                      <span className={`alert-badge-chip ${alert.level}`}>
                        {alert.level.toUpperCase()}
                      </span>
                      <span className="alert-card-time font-mono">{relTime(alert.timestamp)}</span>
                    </div>

                    <div className="alert-card-body">
                      <h4 className="alert-card-facility font-display">{alert.buildingName || alert.buildingId}</h4>
                      <p className="alert-card-msg">
                        {(alert.triggeredSensors || []).map(s =>
                          `${s.name}: ${s.value?.toFixed(1)} ${s.unit}`
                        ).join(' &bull; ') || alert.module || 'Anomaly pattern detected in telemetry'}
                      </p>
                    </div>

                    <div className="alert-card-footer">
                      <span className="alert-inspect-action">Inspect 3D Node &rarr;</span>
                      {alert.count > 1 && (
                        <span className="alert-repeat-tag font-mono">Repeated {alert.count}x</span>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
