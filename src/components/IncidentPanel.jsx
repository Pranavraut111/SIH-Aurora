/* ═══════════════════════════════════════════════════════════════
   Aurora v2 — Incident Panel
   Rich incident cards showing:
   Problem → Cause → Affected → Risk → Action → Outcome
   ═══════════════════════════════════════════════════════════════ */
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuShieldAlert, LuTriangleAlert, LuActivity, LuArrowRight,
  LuCircleCheck, LuX, LuChevronDown, LuChevronUp,
} from 'react-icons/lu';
import { useState } from 'react';
import './IncidentPanel.css';

const RISK_COLORS = {
  CRITICAL: 'var(--status-critical)',
  HIGH: 'var(--status-warning)',
  MODERATE: '#f59e0b',
  LOW: 'var(--text-muted)',
};

export default function IncidentPanel({ incidents = [], onClose }) {
  const [expandedId, setExpandedId] = useState(null);

  if (incidents.length === 0) return null;

  return (
    <motion.div
      className="incident-panel glass-panel"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="ip-header">
        <LuShieldAlert size={16} strokeWidth={1.5} style={{ color: 'var(--status-critical)' }} />
        <h3 className="ip-title">Active Incidents</h3>
        <span className="ip-count">{incidents.length}</span>
      </div>

      <div className="ip-list">
        <AnimatePresence initial={false}>
          {incidents.map((inc) => {
            const isExpanded = expandedId === inc.id;
            const riskColor = RISK_COLORS[inc.riskLevel] || RISK_COLORS.MODERATE;

            return (
              <motion.div
                key={inc.id}
                className="ip-card"
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                {/* Header */}
                <button
                  className="ip-card-header"
                  onClick={() => setExpandedId(isExpanded ? null : inc.id)}
                >
                  <span className="ip-risk-badge" style={{ background: riskColor }}>
                    {inc.riskLevel}
                  </span>
                  <span className="ip-card-title">{inc.title}</span>
                  {isExpanded ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
                </button>

                {/* Expanded details */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      className="ip-card-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* ID + Timestamp */}
                      <div className="ip-row ip-meta">
                        <span className="font-mono">{inc.id}</span>
                        <span>{new Date(inc.timestamp).toLocaleTimeString('en-IN', { hour12: false })}</span>
                      </div>

                      {/* What happened */}
                      <div className="ip-section">
                        <span className="ip-section-label">Problem</span>
                        <span className="ip-section-value">{inc.title} at {inc.rootBuildingName}</span>
                      </div>

                      {/* Why */}
                      <div className="ip-section">
                        <span className="ip-section-label">Cause</span>
                        <span className="ip-section-value">{inc.cause}</span>
                      </div>

                      {/* Correlated readings */}
                      {Object.keys(inc.correlatedReadings || {}).length > 0 && (
                        <div className="ip-section">
                          <span className="ip-section-label">Evidence</span>
                          <div className="ip-readings">
                            {Object.entries(inc.correlatedReadings).map(([sensorId, { value }]) => (
                              <span key={sensorId} className="ip-reading font-mono">
                                {sensorId}: {typeof value === 'number' ? value.toFixed(1) : value}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* What's affected */}
                      <div className="ip-section">
                        <span className="ip-section-label">Affected ({inc.affectedCount} systems)</span>
                        <div className="ip-affected-chain">
                          <span className="ip-chain-node ip-chain-root">{inc.rootBuildingName}</span>
                          {inc.affectedSystems.map((sys, i) => (
                            <span key={sys.id} className="ip-chain-item">
                              <LuArrowRight size={10} className="ip-chain-arrow" />
                              <span className="ip-chain-node">{sys.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Recommendation */}
                      <div className="ip-section">
                        <span className="ip-section-label">Recommended Action</span>
                        <span className="ip-section-value ip-recommendation">{inc.recommendation}</span>
                      </div>

                      {/* Recommended response (not auto-executed) */}
                      <div className="ip-section ip-auto-action">
                        <LuCircleCheck size={13} style={{ color: 'var(--accent)' }} />
                        <span>Recommended: {inc.recommendedAction}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
