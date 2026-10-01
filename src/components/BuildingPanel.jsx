/* ═══════════════════════════════════════════════════════════════
   Aurora — Building Detail Side Panel
   Glassmorphic slide-in panel with live sensor data,
   animated numbers, sparkline charts, and alert status.
   ═══════════════════════════════════════════════════════════════ */
import { useRef, useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BUILDINGS, getSensorDefs, DEPENDENCY_GRAPH } from '../data/stationData';
import { Icon } from './IconMap';
import { LuX } from 'react-icons/lu';
import './BuildingPanel.css';

// ── Animated counter hook ───────────────────────────────────
function useAnimatedValue(target, duration = 500) {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef(null);
  const startVal = useRef(target);
  const startTime = useRef(null);

  useEffect(() => {
    startVal.current = display;
    startTime.current = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startVal.current + (target - startVal.current) * eased;
      setDisplay(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  return display;
}

// ── Sparkline mini-chart (imported from standalone component) ──
import Sparkline from './Sparkline';


// ── Sensor Row Component ────────────────────────────────────
function SensorRow({ sensor, value, history, index }) {
  const animatedVal = useAnimatedValue(value);
  const decimals = sensor.unit === 'rpm' || sensor.unit === 'ppm' ? 0 : sensor.unit === 'pH' ? 2 : 1;

  // Determine status
  let status = 'normal';
  if (sensor.criticalHigh && value >= sensor.criticalHigh) status = 'critical';
  else if (sensor.criticalLow && value <= sensor.criticalLow) status = 'critical';
  else if (sensor.warningHigh && value >= sensor.warningHigh) status = 'warning';
  else if (sensor.warningLow && value <= sensor.warningLow) status = 'warning';

  const statusColor = status === 'critical' ? 'var(--status-critical)' :
                      status === 'warning' ? 'var(--status-warning)' :
                      'var(--accent-primary)';

  return (
    <motion.div
      className="sensor-row"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 + index * 0.05, type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="sensor-info">
        <span className="sensor-name">{sensor.name}</span>
        <div className="sensor-value-row">
          <span className="sensor-value font-mono" style={{ color: statusColor }}>
            {animatedVal.toFixed(decimals)}
          </span>
          <span className="sensor-unit">{sensor.unit}</span>
          {status !== 'normal' && (
            <span className={`sensor-badge badge badge-${status}`}>
              {status}
            </span>
          )}
        </div>
      </div>
      <Sparkline data={history} color={statusColor} alertLevel={status} />
    </motion.div>
  );
}

// ── Main Panel Component ────────────────────────────────────
export default function BuildingPanel({ buildingId, sensorData, historyData, alertLevel, onClose }) {
  const building = BUILDINGS[buildingId];
  if (!building) return null;

  const sensors = getSensorDefs(buildingId);
  const deps = DEPENDENCY_GRAPH[buildingId];

  const moduleColors = {
    infrastructure: 'var(--module-infrastructure)',
    energy: 'var(--module-energy)',
    logistics: 'var(--module-logistics)',
    environmental: 'var(--module-environmental)',
  };

  const moduleColor = moduleColors[building.module] || 'var(--accent-primary)';

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={buildingId}
        className="building-panel glass-panel"
        initial={{ x: 400, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 400, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 32 }}
      >
        {/* Header */}
        <div className="panel-header">
          <div className="panel-header-top">
            <span className="panel-icon"><Icon name={building.icon} size={24} /></span>
            <button className="panel-close btn-ghost" onClick={onClose} aria-label="Close panel">
              <LuX size={18} strokeWidth={1.5} />
            </button>
          </div>
          <h2 className="panel-title font-display">{building.name}</h2>
          <p className="panel-desc">{building.description}</p>
          <div className="panel-meta">
            <span className="module-chip" style={{ borderColor: moduleColor, color: moduleColor }}>
              {building.module}
            </span>
            <span className={`status-chip badge badge-${alertLevel || 'success'}`}>
              <span className="status-dot" style={{
                background: alertLevel === 'critical' ? 'var(--status-critical)' :
                            alertLevel === 'warning' ? 'var(--status-warning)' :
                            'var(--status-success)'
              }} />
              {alertLevel === 'critical' ? 'CRITICAL' : alertLevel === 'warning' ? 'WARNING' : 'NORMAL'}
            </span>
          </div>
        </div>

        {/* Sensor readings */}
        <div className="panel-sensors">
          <h3 className="panel-section-title">Live Readings</h3>
          {sensors.map((sensor, i) => (
            <SensorRow
              key={sensor.id}
              sensor={sensor}
              value={sensorData?.[sensor.id] ?? sensor.nominal}
              history={historyData?.[sensor.id] || []}
              index={i}
            />
          ))}
        </div>

        {/* Dependencies */}
        {deps && (deps.depends.length > 0 || deps.feeds.length > 0) && (
          <div className="panel-deps">
            <h3 className="panel-section-title">Dependencies</h3>
            {deps.depends.length > 0 && (
              <div className="dep-group">
                <span className="dep-label">Depends on:</span>
                <div className="dep-chips">
                  {deps.depends.map(dep => (
                    <span key={dep} className="dep-chip">
                      <Icon name={BUILDINGS[dep]?.icon || dep} size={14} /> {BUILDINGS[dep]?.name || dep}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {deps.feeds.length > 0 && (
              <div className="dep-group">
                <span className="dep-label">Feeds into:</span>
                <div className="dep-chips">
                  {deps.feeds.map(dep => (
                    <span key={dep} className="dep-chip">
                      <Icon name={BUILDINGS[dep]?.icon || dep} size={14} /> {BUILDINGS[dep]?.name || dep}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Provenance Badge */}
        <div className="panel-provenance-footer">
          <span>Provenance: <strong>Aurora physics model (MODEL-DERIVED / SIMULATED)</strong></span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
