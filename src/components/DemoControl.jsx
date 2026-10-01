/* ═══════════════════════════════════════════════════════════════
   Aurora — Developer / Test Mode Panel
   Anomaly injection scenarios for SIH judges.
   Normal operation runs organically — these are for reproducing
   specific scenarios during judging.
   ═══════════════════════════════════════════════════════════════ */
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuZap, LuFlame, LuSnowflake, LuDroplets, LuWind,
  LuX, LuPlay, LuRotateCcw, LuTriangleAlert, LuSettings,
} from 'react-icons/lu';
import './DemoControl.css';
import { apiGet, apiPost } from '../services/api';
import { usePolling } from '../hooks/usePolling';


const SCENARIO_ICONS = {
  generator_failure: LuZap,
  heating_failure: LuFlame,
  blizzard: LuSnowflake,
  water_crisis: LuDroplets,
  co2_spike: LuWind,
};

const SCENARIO_COLORS = {
  generator_failure: '#f87171',
  heating_failure: '#fb923c',
  blizzard: '#60a5fa',
  water_crisis: '#34d399',
  co2_spike: '#c084fc',
};

export default function DemoControl({ activeStation = 'maitri' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [scenarios, setScenarios] = useState({});
  const [activeScenario, setActiveScenario] = useState(null);
  const [injecting, setInjecting] = useState(null);
  const [tickCount, setTickCount] = useState(0);
  const [error, setError] = useState(null);

  const describe = (e) => (e?.status === 503 ? 'Simulator offline'
    : e?.kind === 'http' ? `Backend error (HTTP ${e.status})` : 'Backend unreachable');

  // Fetch available scenarios for the ACTIVE station (B14), via the backend proxy
  usePolling(async (isActive) => {
    try {
      const data = await apiGet(`/sim/scenarios?stationId=${activeStation}`);
      if (!isActive()) return;
      setScenarios(data?.scenarios || {});
      setActiveScenario(data?.activeScenario ?? null);
      setTickCount(data?.tickCount ?? 0);
      setError(null);
    } catch (e) {
      if (isActive()) setError(describe(e));
      throw e;                         // let usePolling back off (logged there)
    }
  }, 3000, { key: activeStation });

  const triggerScenario = useCallback(async (scenarioId) => {
    setInjecting(scenarioId);
    try {
      await apiPost(`/sim/inject/${scenarioId}?stationId=${activeStation}`);
      setActiveScenario(scenarioId);
      setError(null);
      setTimeout(() => setInjecting(null), 1000);
    } catch (e) {
      console.error('Failed to inject scenario:', e);
      setError(`Inject failed: ${describe(e)}`);
      setInjecting(null);
    }
  }, [activeStation]);

  const resetAll = useCallback(async () => {
    try {
      await apiPost(`/sim/reset?stationId=${activeStation}`);
      setActiveScenario(null);
      setError(null);
    } catch (e) {
      console.error('Failed to reset:', e);
      setError(`Reset failed: ${describe(e)}`);
    }
  }, [activeStation]);

  return (
    <>
      {/* Floating toggle — labeled icon button in vertical toolbar */}
      <motion.button
        className="demo-toggle"
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="Demo Control Panel"
      >
        {isOpen ? <LuX size={18} strokeWidth={1.5} /> : <LuSettings size={18} strokeWidth={1.5} />}
        {activeScenario && !isOpen && (
          <span className="demo-toggle-active-dot" />
        )}
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="demo-panel glass-panel"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          >
            <div className="demo-header">
              <LuPlay size={16} strokeWidth={1.5} className="demo-header-icon" />
              <h3 className="demo-title font-display">Demo Control</h3>
              <span className="demo-tick font-mono tabular-nums">Tick #{tickCount}</span>
            </div>
            <p className="demo-subtitle text-caption">
              Inject a synthetic fault into <strong>{activeStation === 'maitri' ? 'Maitri' : 'Bharati'}</strong> to exercise anomaly detection and the decision engine.
            </p>
            {error && <p className="demo-subtitle text-caption" role="status" style={{ color: '#f87171' }}>{error}</p>}

            {/* Active scenario indicator */}
            <AnimatePresence>
              {activeScenario && scenarios[activeScenario] && (
                <motion.div
                  className="demo-active"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <div className="demo-active-header">
                    <span className="demo-active-icon">
                      {(() => {
                        const ScIcon = SCENARIO_ICONS[activeScenario] || LuTriangleAlert;
                        return <ScIcon size={16} strokeWidth={1.5} />;
                      })()}
                    </span>
                    <span className="demo-active-name">
                      {scenarios[activeScenario]?.name}
                    </span>
                    <span className="demo-active-badge">ACTIVE</span>
                  </div>
                  <div className="demo-active-bar">
                    <motion.div
                      className="demo-active-progress"
                      initial={{ width: '100%' }}
                      animate={{ width: '0%' }}
                      transition={{ duration: scenarios[activeScenario]?.duration || 30, ease: 'linear' }}
                      style={{ background: SCENARIO_COLORS[activeScenario] || '#f87171' }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scenario buttons */}
            <div className="demo-scenarios">
              {Object.entries(scenarios).map(([id, scenario]) => {
                const ScIcon = SCENARIO_ICONS[id] || LuTriangleAlert;
                return (
                  <button
                    key={id}
                    className={`demo-scenario-btn ${activeScenario === id ? 'active' : ''} ${injecting === id ? 'injecting' : ''}`}
                    onClick={() => triggerScenario(id)}
                    disabled={activeScenario === id}
                    style={{ '--scenario-color': SCENARIO_COLORS[id] || '#f87171' }}
                  >
                    <span className="demo-scenario-icon" style={{ color: SCENARIO_COLORS[id] }}>
                      <ScIcon size={16} strokeWidth={1.5} />
                    </span>
                    <div className="demo-scenario-info">
                      <span className="demo-scenario-name">{scenario.name}</span>
                      <span className="demo-scenario-desc">{scenario.description}</span>
                    </div>
                    <span className="demo-scenario-duration font-mono tabular-nums">
                      {scenario.duration}s
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Reset button */}
            <button className="demo-reset-btn btn-secondary" onClick={resetAll}>
              <LuRotateCcw size={14} strokeWidth={1.5} /> Reset All to Normal
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
