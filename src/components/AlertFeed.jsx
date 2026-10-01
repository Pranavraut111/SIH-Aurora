/* ═══════════════════════════════════════════════════════════════
   Aurora — Alert drawer
   Active alerts come from the backend alert engine (thresholds for every
   sensor; persisted in SQLite). Acknowledge records who/when; an alert stays
   listed until its condition clears for N ticks and it auto-resolves.
   The History tab reads GET /api/alerts/history.
   ═══════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuTriangleAlert,
  LuX,
  LuCircleCheck,
  LuActivity,
} from 'react-icons/lu';
import { apiGet, describeApiError } from '../services/api';
import './AlertFeed.css';

function relTime(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function AlertFeed({
  isOpen = true,
  onClose,
  alerts = [],
  onAlertClick,
  onAcknowledge,
  activeStation = 'maitri',
  canAcknowledge = true,
}) {
  const [tab, setTab] = useState('active');
  const [history, setHistory] = useState({ station: null, rows: [], error: null });
  const [ackState, setAckState] = useState({});   // alertId → 'pending' | error text

  const sorted = [...(alerts || [])].sort((a, b) => {
    if (a.level !== b.level) return a.level === 'critical' ? -1 : 1;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
  const criticalCount = sorted.filter(a => a.level === 'critical').length;
  const warningCount = sorted.filter(a => a.level === 'warning').length;

  useEffect(() => {
    if (!isOpen || tab !== 'history') return undefined;
    let alive = true;
    apiGet(`/alerts/history?stationId=${activeStation}&limit=50`)
      .then((d) => { if (alive) setHistory({ station: activeStation, rows: d.alerts || [], error: null }); })
      .catch((err) => {
        console.error('[Alerts] history failed', err);
        if (alive) setHistory({ station: activeStation, rows: [], error: describeApiError(err) });
      });
    return () => { alive = false; };
  }, [isOpen, tab, activeStation]);

  const acknowledge = async (e, alertId) => {
    e.stopPropagation();
    setAckState((s) => ({ ...s, [alertId]: 'pending' }));
    const res = await onAcknowledge?.(alertId);
    setAckState((s) => ({ ...s, [alertId]: res?.ok ? undefined : (res?.error || 'failed') }));
  };

  const historyRows = history.station === activeStation ? history.rows : [];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {onClose && (
            <motion.div
              className="alert-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
          )}

          <motion.div
            className="alert-drawer glass-panel"
            initial={{ opacity: 0, x: 380 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 380 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            data-testid="alert-drawer"
          >
            <div className="alert-drawer-header">
              <div className="alert-drawer-title-wrap">
                <LuTriangleAlert size={18} className="alert-drawer-icon text-warning" />
                <h3 className="alert-drawer-title font-display">Station Alerts</h3>
                <span className="alert-count-badge font-mono tabular-nums">{sorted.length}</span>
              </div>
              {onClose && (
                <button className="alert-close-btn" onClick={onClose} title="Close">
                  <LuX size={16} />
                </button>
              )}
            </div>

            <div className="alert-summary-strip">
              <div className="alert-sum-box">
                <span className="sum-label">Critical</span>
                <span className={`sum-val font-mono ${criticalCount > 0 ? 'text-danger' : 'text-muted'}`}>{criticalCount}</span>
              </div>
              <div className="alert-sum-box">
                <span className="sum-label">Warnings</span>
                <span className={`sum-val font-mono ${warningCount > 0 ? 'text-warning' : 'text-muted'}`}>{warningCount}</span>
              </div>
              <div className="alert-sum-box">
                <span className="sum-label">View</span>
                <span className="sum-val font-mono">
                  <button type="button" className={`alert-tab-btn ${tab === 'active' ? 'active' : ''}`} onClick={() => setTab('active')}>Active</button>
                  <button type="button" className={`alert-tab-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</button>
                </span>
              </div>
            </div>

            <div className="alert-drawer-list">
              {tab === 'history' ? (
                history.error ? (
                  <p className="empty-desc text-danger">History unavailable: {history.error}</p>
                ) : historyRows.length === 0 ? (
                  <p className="empty-desc">No alerts recorded for this station.</p>
                ) : (
                  historyRows.map((h) => (
                    <div key={h.id} className={`alert-card-item ${h.level}`} data-testid="alert-history-row">
                      <div className="alert-card-top">
                        <span className={`alert-badge-chip ${h.peakLevel}`}>{h.peakLevel.toUpperCase()}</span>
                        <span className="alert-card-time font-mono">{new Date(h.raisedAt).toLocaleString()}</span>
                      </div>
                      <div className="alert-card-body">
                        <h4 className="alert-card-facility font-display">{h.buildingName} · {h.sensor}</h4>
                        <p className="alert-card-msg">{h.message}</p>
                      </div>
                      <div className="alert-card-footer">
                        <span className="alert-inspect-action">
                          {h.status}{h.resolvedAt ? ` ${new Date(h.resolvedAt).toLocaleTimeString()}` : ''}
                          {h.acknowledgedBy ? ` · ack by ${h.acknowledgedBy}` : ''}
                        </span>
                      </div>
                    </div>
                  ))
                )
              ) : sorted.length === 0 ? (
                <div className="alert-empty-state">
                  <LuCircleCheck size={32} className="empty-icon text-success" />
                  <h4 className="empty-title font-display">No active alerts</h4>
                  <p className="empty-desc">Every sensor is inside its warning thresholds.</p>
                </div>
              ) : (
                sorted.map((alert, i) => (
                  <motion.div
                    key={alert.id || `${alert.buildingId}-${alert.level}-${i}`}
                    className={`alert-card-item ${alert.level}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => {
                      onAlertClick?.(alert.buildingId);
                      onClose?.();
                    }}
                    data-testid="alert-card"
                    data-alert-id={alert.id}
                  >
                    <div className="alert-card-top">
                      <span className={`alert-badge-chip ${alert.level}`}>{alert.level.toUpperCase()}</span>
                      <span className="alert-card-time font-mono">{relTime(alert.timestamp)}</span>
                    </div>

                    <div className="alert-card-body">
                      <h4 className="alert-card-facility font-display">{alert.buildingName || alert.buildingId}</h4>
                      <p className="alert-card-msg">
                        {alert.message || (alert.triggeredSensors || []).map(s =>
                          `${s.name}: ${typeof s.value === 'number' ? s.value.toFixed(1) : s.value} ${s.unit}`).join(' · ')}
                      </p>
                    </div>

                    <div className="alert-card-footer">
                      {alert.acknowledged ? (
                        <span className="alert-inspect-action text-success" data-testid="alert-acked">
                          <LuActivity size={12} /> Acknowledged by {alert.acknowledgedBy}
                          {alert.clearing ? ' · clearing' : ''}
                        </span>
                      ) : canAcknowledge && alert.id ? (
                        <button
                          type="button"
                          className="alert-ack-btn"
                          onClick={(e) => acknowledge(e, alert.id)}
                          disabled={ackState[alert.id] === 'pending'}
                          data-testid="alert-ack-btn"
                        >
                          {ackState[alert.id] === 'pending' ? 'Acknowledging…' : 'Acknowledge'}
                        </button>
                      ) : (
                        <span className="alert-inspect-action text-muted">Demo alert (not acknowledgeable)</span>
                      )}
                      {ackState[alert.id] && ackState[alert.id] !== 'pending' && (
                        <span className="alert-repeat-tag text-danger">{ackState[alert.id]}</span>
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
