import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuPlay, LuSlidersHorizontal, LuTriangleAlert, LuZap, LuFlame,
  LuDroplets, LuRadioTower, LuShieldAlert, LuArrowRight, LuSparkles,
  LuBatteryCharging, LuRotateCcw, LuCheck, LuActivity, LuInfo
} from 'react-icons/lu';
import './WhatIfSimulationPanel.css';
import { apiPost } from '../services/api';

const SCENARIOS = [
  {
    id: 'extreme_cold',
    name: 'Polar Vortex / Deep Cold Wave',
    desc: 'Rapid 20°C plunge in ambient air temperature triggering extreme structural heat loss and maximum heating circuit demand.',
    icon: LuFlame,
    color: '#38bdf8',
    defaultIntensity: 1.0,
    impactedDomain: 'Heating & Electrical Grid',
  },
  {
    id: 'blizzard',
    name: 'Category-4 Antarctic Blizzard',
    desc: 'Sustained gale winds (>100 km/h) with severe snow drifting, increased convection loss, and antenna gimbal stress.',
    icon: LuShieldAlert,
    color: '#f59e0b',
    defaultIntensity: 1.2,
    impactedDomain: 'Structural & Satellite Comms',
  },
  {
    id: 'gen_failure',
    name: 'Primary Diesel Genset #1 Trip',
    desc: 'Sudden mechanical shutdown of main 200 kW generator. Triggers static UPS battery transfer and essential load shedding.',
    icon: LuZap,
    color: '#ef4444',
    defaultIntensity: 1.0,
    impactedDomain: 'Power Generation & Life Support',
  },
  {
    id: 'battery_failure',
    name: 'Station Battery Bank / UPS Fault',
    desc: 'Internal cell thermal runaway fault disconnecting the 120 kWh UPS buffer, exposing generator to unbuffered inductive spikes.',
    icon: LuBatteryCharging,
    color: '#f97316',
    defaultIntensity: 1.0,
    impactedDomain: 'DC Bus & Transient Buffer',
  },
  {
    id: 'fuel_leak',
    name: 'Fuel Supply Manifold Leak',
    desc: 'Unmetered high-pressure fuel leak in distribution trench reducing station diesel longevity and triggering vapor alarm.',
    icon: LuDroplets,
    color: '#ec4899',
    defaultIntensity: 1.0,
    impactedDomain: 'Fuel Logistics & Containment',
  },
  {
    id: 'comms_outage',
    name: 'Polar Satellite Link Blackout',
    desc: 'Severe geomagnetic storm disrupting C/Ku-band VSAT link. Forces autonomous edge-level PLC survival governing.',
    icon: LuRadioTower,
    color: '#6366f1',
    defaultIntensity: 1.0,
    impactedDomain: 'Satellite Uplink & Telemetry',
  },
  {
    id: 'resupply_delay',
    name: 'Icebound Resupply Delay (+60d)',
    desc: 'Expedition vessel blocked by multi-year fast ice pack in Prydz Bay. Enforces emergency winter conservation rationing.',
    icon: LuSlidersHorizontal,
    color: '#a855f7',
    defaultIntensity: 1.0,
    impactedDomain: 'Logistics Autonomy & Food Rations',
  }
];

export default function WhatIfSimulationPanel({ activeStation = 'maitri', sensorData = {} }) {
  const [selectedScenario, setSelectedScenario] = useState(SCENARIOS[0]);
  const [intensity, setIntensity] = useState(1.0);
  const [simResult, setSimResult] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Fallback baseline from props or defaults if sensorData is empty
  const lab = sensorData?.lab || {};
  const gen = sensorData?.generator || {};
  const baselineTemp = typeof lab.env_temp === 'number' ? lab.env_temp : -12.8;
  const baselineWind = typeof lab.env_wind === 'number' ? lab.env_wind : 42.0;
  const baselinePower = typeof gen.gen_power === 'number' ? gen.gen_power : 158.0;
  const baselineFuel = typeof gen.gen_fuel_rate === 'number' ? gen.gen_fuel_rate : 28.5;

  const handleRunSimulation = async () => {
    setSimulating(true);
    setErrorMsg(null);
    try {
      const d = await apiPost('/simulation/whatif', {
        stationId: activeStation,
        scenarioId: selectedScenario.id,
        intensity: Number(intensity)
      });
      setSimResult(d);
    } catch (e) {
      console.warn('Simulation API error:', e);
      setErrorMsg(`Could not connect to Simulation Engine (${e.message}). Please verify that the backend (VITE_API_URL) is running.`);
    } finally {
      setSimulating(false);
    }
  };

  const handleReset = () => {
    setSimResult(null);
    setErrorMsg(null);
    setIntensity(selectedScenario.defaultIntensity || 1.0);
  };

  return (
    <motion.div
      className="sim-panel-container glass-panel"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
    >
      {/* Header */}
      <div className="sim-header">
        <div className="sim-header-info">
          <div className="sim-title-row">
            <div className="sim-title-icon-wrap">
              <LuSlidersHorizontal size={22} className="sim-title-icon" />
            </div>
            <div>
              <h2 className="sim-title font-display">
                {activeStation === 'maitri' ? 'Maitri' : 'Bharati'} Digital Twin &mdash; What-If Scenario Simulator
              </h2>
              <p className="sim-subtitle text-caption">
                Runs hypothetical hazards through the physics model from the current model baseline (results are MODEL-DERIVED).
              </p>
            </div>
          </div>
        </div>

        {/* Real Baseline Metric Strip */}
        <div className="sim-baseline-strip glass-panel-subtle">
          <div className="baseline-chip">
            <span className="chip-label">Live Baseline Temp</span>
            <span className="chip-val font-mono">{baselineTemp.toFixed(1)}°C</span>
          </div>
          <div className="baseline-chip">
            <span className="chip-label">Observed Wind</span>
            <span className="chip-val font-mono">{baselineWind.toFixed(0)} km/h</span>
          </div>
          <div className="baseline-chip">
            <span className="chip-label">Power Demand</span>
            <span className="chip-val font-mono">{baselinePower.toFixed(0)} kW</span>
          </div>
          <div className="baseline-chip">
            <span className="chip-label">Fuel Burn</span>
            <span className="chip-val font-mono">{baselineFuel.toFixed(1)} L/h</span>
          </div>
        </div>
      </div>

      {/* Scenario Selection Cards */}
      <div className="scenarios-grid">
        {SCENARIOS.map((sc) => {
          const isSelected = selectedScenario.id === sc.id;
          const IconComp = sc.icon;
          return (
            <motion.div
              key={sc.id}
              className={`scenario-card ${isSelected ? 'active' : ''}`}
              onClick={() => {
                setSelectedScenario(sc);
                setIntensity(sc.defaultIntensity);
                setSimResult(null);
                setErrorMsg(null);
              }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="scenario-card-header">
                <div
                  className="scenario-icon-box"
                  style={{
                    background: `color-mix(in srgb, ${sc.color} 22%, transparent)`,
                    color: sc.color,
                    boxShadow: isSelected ? `0 0 12px ${sc.color}40` : 'none'
                  }}
                >
                  <IconComp size={18} />
                </div>
                <div className="scenario-meta">
                  <span className="scenario-name">{sc.name}</span>
                  <span className="scenario-domain text-caption">{sc.impactedDomain}</span>
                </div>
              </div>
              <p className="scenario-desc text-caption">{sc.desc}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Controls Bar */}
      <div className="sim-controls-bar glass-panel-subtle">
        <div className="intensity-control">
          <div className="intensity-label-row">
            <label>
              Hazard Stress Multiplier: <strong>{intensity.toFixed(1)}x</strong>
            </label>
            <span className="intensity-badge text-caption font-mono">
              {intensity < 1.0 ? 'Mild Stress' : intensity === 1.0 ? 'Design Limit (100%)' : 'Severe Overload (150-200%)'}
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={intensity}
            onChange={(e) => setIntensity(parseFloat(e.target.value))}
            className="sim-slider"
          />
        </div>

        <div className="sim-action-buttons">
          {simResult && (
            <button className="btn-reset-sim" onClick={handleReset}>
              <LuRotateCcw size={15} /> Reset
            </button>
          )}
          <button
            className={`btn-run-sim ${simulating ? 'loading' : ''}`}
            onClick={handleRunSimulation}
            disabled={simulating}
          >
            <LuPlay size={16} />
            {simulating ? 'Computing Physics Impact...' : `Simulate ${selectedScenario.name}`}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div className="sim-error-banner glass-panel-subtle">
          <LuTriangleAlert size={18} className="error-icon" />
          <span>{errorMsg}</span>
          <button onClick={handleRunSimulation} className="btn-retry">Retry</button>
        </div>
      )}

      {/* Simulation Results View */}
      {simResult && (
        <motion.div
          className="sim-results-container"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Causal Impact Flow Strip */}
          <div className="results-header-row">
            <h3 className="sim-results-title font-display">
              Physical Causal Cascade Breakdown &mdash; {selectedScenario.name}
            </h3>
            <span className={`risk-badge badge-${simResult.calculatedRisk?.level || 'critical'}`}>
              Risk Score: {simResult.calculatedRisk?.score}/100 ({simResult.calculatedRisk?.level?.toUpperCase()})
            </span>
          </div>

          <div className="causal-cascade-strip">
            <div className="cascade-node">
              <span className="node-step">1. Physical Environmental Shock</span>
              <span className="node-val font-mono">
                {simResult.simulated?.lab?.env_temp?.toFixed(1) ?? '--'}°C / {simResult.simulated?.lab?.env_wind?.toFixed(0) ?? '--'} km/h
              </span>
              <span className="node-sub">
                ΔTemp: {simResult.deltas?.temperature_delta ? (simResult.deltas.temperature_delta > 0 ? `+${simResult.deltas.temperature_delta}` : simResult.deltas.temperature_delta) : '0'}°C
              </span>
            </div>

            <LuArrowRight size={18} className="cascade-arrow" />

            <div className="cascade-node">
              <span className="node-step">2. Power Grid Demand</span>
              <span className="node-val font-mono" style={{ color: '#38bdf8' }}>
                {simResult.simulated?.generator?.gen_power?.toFixed(1) ?? '--'} kW
              </span>
              <span className="node-sub">
                ΔPower: {simResult.deltas?.power_delta ? (simResult.deltas.power_delta > 0 ? `+${simResult.deltas.power_delta}` : simResult.deltas.power_delta) : '0'} kW
              </span>
            </div>

            <LuArrowRight size={18} className="cascade-arrow" />

            <div className="cascade-node">
              <span className="node-step">3. Fuel Logistics Burn</span>
              <span className="node-val font-mono" style={{ color: '#f59e0b' }}>
                {simResult.simulated?.generator?.gen_fuel_rate?.toFixed(1) ?? '--'} L/hr
              </span>
              <span className="node-sub">
                ΔBurn: {simResult.deltas?.fuel_rate_delta ? (simResult.deltas.fuel_rate_delta > 0 ? `+${simResult.deltas.fuel_rate_delta}` : simResult.deltas.fuel_rate_delta) : '0'} L/h
              </span>
            </div>

            <LuArrowRight size={18} className="cascade-arrow" />

            <div className="cascade-node alert">
              <span className="node-step">4. Cascading Risk Evaluation</span>
              <span className="node-val font-mono" style={{ color: simResult.calculatedRisk?.level === 'critical' ? '#ef4444' : '#f59e0b' }}>
                {simResult.calculatedRisk?.score ?? 80}/100
              </span>
              <span className="node-sub font-mono">{simResult.calculatedRisk?.level?.toUpperCase() ?? 'CRITICAL'}</span>
            </div>
          </div>

          {/* Affected Subsystems Badges */}
          {simResult.affectedSubsystems && simResult.affectedSubsystems.length > 0 && (
            <div className="affected-subsystems-row">
              <span className="affected-label text-label">Impacted Station Subsystems:</span>
              <div className="subsystem-badges">
                {simResult.affectedSubsystems.map((sub, i) => (
                  <span key={i} className="subsystem-tag">
                    <LuActivity size={12} /> {sub}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Detailed Consequences & Recommended Actions Grid */}
          <div className="sim-consequences-grid">
            <div className="consequences-card glass-panel-subtle">
              <h4 className="consequence-head">
                <LuTriangleAlert size={16} /> Simulated Operational Consequences
              </h4>
              <ul className="consequence-list">
                {simResult.consequences?.map((c, idx) => (
                  <li key={idx}>
                    <span className="bullet">⚡</span> {c}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mitigation-card glass-panel-subtle">
              <h4 className="mitigation-head">
                <LuSparkles size={16} /> AI Recommended Engineering Mitigation
              </h4>
              <p className="mitigation-body">
                {simResult.calculatedRisk?.recommendedAction}
              </p>
              <div className="provenance-tag">
                <LuInfo size={13} /> {simResult.provenance}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
