/* ═══════════════════════════════════════════════════════════════
   Aurora — Infrastructure & Energy Grid Dashboards (SIH 26060)
   Structured mission control views with live telemetry,
   equipment status matrix, interactive dependency graph, and microgrid flow.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { BUILDINGS, DEPENDENCY_GRAPH } from '../data/stationData';
import DependencyGraph from './DependencyGraph';
import {
  LuBuilding2,
  LuZap,
  LuCpu,
  LuLayers,
  LuGauge,
  LuFlame,
  LuActivity,
  LuShieldCheck,
  LuShieldAlert,
  LuTriangleAlert,
  LuCircleCheck,
  LuDroplets,
  LuRadio,
  LuFuel,
  LuThermometerSnowflake,
} from 'react-icons/lu';
import './ModulePanels.css';

// ── Building Status Card ──────────────────────────────────────
function BuildingCard({ buildingId, building, sensors = {}, alertLevel = 'normal', onClick }) {
  const sensorEntries = Object.entries(sensors);
  const isNormal = alertLevel === 'normal';

  const getIcon = (id) => {
    switch (id) {
      case 'generator': return <LuZap size={18} />;
      case 'livingQuarters': return <LuBuilding2 size={18} />;
      case 'lab': return <LuCpu size={18} />;
      case 'storage': return <LuFuel size={18} />;
      case 'commsMast': return <LuRadio size={18} />;
      case 'waterTank': return <LuDroplets size={18} />;
      default: return <LuBuilding2 size={18} />;
    }
  };

  return (
    <motion.div
      className={`infra-card ${alertLevel}`}
      onClick={() => onClick?.(buildingId)}
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="infra-card-header">
        <div className="infra-card-icon-box">
          {getIcon(buildingId)}
        </div>
        <div className="infra-card-title-wrap">
          <h4 className="infra-card-name font-display">{building?.name || buildingId}</h4>
          <span className="infra-card-module-tag text-caption">{building?.module || 'Facility'}</span>
        </div>
        <span className={`infra-card-badge badge-${alertLevel}`}>
          {alertLevel.toUpperCase()}
        </span>
      </div>

      <div className="infra-card-readings">
        {sensorEntries.length > 0 ? (
          sensorEntries.slice(0, 3).map(([key, val]) => (
            <div key={key} className="infra-reading-row">
              <span className="infra-reading-name">{key.replace(/_/g, ' ')}</span>
              <span className="infra-reading-val font-mono tabular-nums">
                {typeof val === 'number' ? val.toFixed(1) : val}
              </span>
            </div>
          ))
        ) : (
          <div className="infra-reading-empty text-caption">Telemetry nominal</div>
        )}
      </div>

      <div className="infra-card-footer">
        <span className="infra-card-inspect-hint">Click to open 3D inspection &rarr;</span>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INFRASTRUCTURE DASHBOARD
// ═══════════════════════════════════════════════════════════════
export function InfrastructurePanel({ sensorData = {}, alerts = {}, onBuildingClick, dependencyAlerts = [], aiHealth = 'healthy' }) {
  const buildingKeys = Object.keys(BUILDINGS);
  const alertValues = Object.values(alerts);
  const criticalCount = alertValues.filter(a => a === 'critical').length;
  const warningCount = alertValues.filter(a => a === 'warning').length;
  const normalCount = alertValues.filter(a => a === 'normal').length;

  return (
    <div className="infra-module-container">
      {/* Top Header */}
      <div className="infra-header glass-panel">
        <div className="infra-header-left">
          <div className="infra-header-icon-box">
            <LuBuilding2 size={24} className="infra-header-icon" />
          </div>
          <div>
            <div className="infra-title-row">
              <h1 className="infra-title font-display">Station Infrastructure & Subsystems</h1>
              <span className="infra-badge-active">POLAR DIGITAL TWIN MATRIX</span>
            </div>
            <p className="infra-subtitle">
              Live facility health, automated HVAC/power routing, and cascading failure monitoring.
            </p>
          </div>
        </div>

        {/* Quick Health KPI Chips */}
        <div className="infra-header-kpis">
          <div className="infra-kpi-chip">
            <span className="kpi-label">Subsystems</span>
            <span className="kpi-value font-mono">{normalCount}/{buildingKeys.length}</span>
            <span className="kpi-sub text-success">Online</span>
          </div>
          <div className="infra-kpi-chip">
            <span className="kpi-label">Anomalies</span>
            <span className={`kpi-value font-mono ${criticalCount > 0 ? 'text-danger' : warningCount > 0 ? 'text-warning' : 'text-success'}`}>
              {criticalCount + warningCount}
            </span>
            <span className="kpi-sub">{criticalCount > 0 ? 'Action Req.' : 'Nominal'}</span>
          </div>
          <div className="infra-kpi-chip">
            <span className="kpi-label">AI Health</span>
            <span className="kpi-value font-mono text-cyan">{aiHealth.toUpperCase()}</span>
            <span className="kpi-sub">Continuous</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Buildings Status Matrix */}
      <div className="infra-section-heading">
        <h3 className="section-title text-label">
          <LuLayers size={14} /> FACILITY TELEMETRY & EQUIPMENT STATUS
        </h3>
      </div>

      <div className="infra-cards-grid">
        {buildingKeys.map((id) => (
          <BuildingCard
            key={id}
            buildingId={id}
            building={BUILDINGS[id]}
            sensors={sensorData[id] || {}}
            alertLevel={alerts[id] || 'normal'}
            onClick={onBuildingClick}
          />
        ))}
      </div>

      {/* Interactive System Dependency Architecture */}
      <div className="infra-section-heading">
        <h3 className="section-title text-label">
          <LuCpu size={14} /> CASCADING DEPENDENCY & AI RISK TOPOLOGY
        </h3>
      </div>

      <div className="infra-dep-wrapper">
        <DependencyGraph
          alerts={alerts}
          onNodeClick={onBuildingClick}
          dependencyAlerts={dependencyAlerts}
          aiHealth={aiHealth}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ENERGY GRID DASHBOARD
// ═══════════════════════════════════════════════════════════════
export function EnergyPanel({ sensorData = {}, alerts = {} }) {
  const genData = sensorData.generator || {};
  const powerKW = genData.gen_power ?? 162;
  const fuelRateLph = genData.gen_fuel_rate ?? 32.4;
  const rpm = genData.gen_rpm ?? 1500;
  const coolantTempC = genData.gen_temp ?? 84.5;
  const oilPressureBar = genData.gen_oil_pressure ?? 4.8;
  const vibrationMm = genData.gen_vibration ?? 1.8;

  // Day tank & autonomy calculation
  const dayTankLiters = 4800;
  const totalFuelLiters = 185000;
  const burnRateDaily = fuelRateLph * 24;
  const autonomyDays = Math.floor(totalFuelLiters / Math.max(burnRateDaily, 100));

  // Power distribution breakdown
  const loadBreakdown = [
    { label: 'Life Support & Heating', pct: 45, kw: powerKW * 0.45, color: '#fbbf24' },
    { label: 'Scientific Instruments', pct: 25, kw: powerKW * 0.25, color: '#38bdf8' },
    { label: 'Communications & Satcom', pct: 15, kw: powerKW * 0.15, color: '#a78bfa' },
    { label: 'Auxiliary & Trace Heating', pct: 15, kw: powerKW * 0.15, color: '#34d399' },
  ];

  return (
    <div className="energy-module-container">
      {/* Header */}
      <div className="energy-header glass-panel">
        <div className="energy-header-left">
          <div className="energy-header-icon-box">
            <LuZap size={24} className="energy-header-icon" />
          </div>
          <div>
            <div className="energy-title-row">
              <h1 className="energy-title font-display">Antarctic Microgrid & Power Management</h1>
              <span className="energy-badge-active">NCPOR CONTINUOUS POWER</span>
            </div>
            <p className="energy-subtitle">
              Synchronized diesel generation, fuel burn optimization, thermal heat exchange, and electrical bus loads.
            </p>
          </div>
        </div>

        <div className="energy-header-status">
          <span className="gen-status-pill online">
            <span className="status-dot-pulse" /> GEN-SET 1 &bull; ONLINE
          </span>
          <span className="gen-status-pill standby">
            GEN-SET 2 &bull; HOT STANDBY
          </span>
        </div>
      </div>

      {/* Hero Metrics Row */}
      <div className="energy-hero-grid">
        {/* Total Power Output Card */}
        <div className="energy-hero-card glass-panel">
          <div className="card-top-row">
            <span className="card-tag text-label">TOTAL GENERATION</span>
            <LuZap size={16} className="text-warning" />
          </div>
          <div className="card-val-row">
            <span className="hero-val font-mono text-warning tabular-nums">{powerKW.toFixed(0)}</span>
            <span className="hero-unit">kW</span>
          </div>
          <div className="card-sub-info">
            <span>Rated: 250 kW (65% Load Factor)</span>
            <div className="hero-bar-track">
              <div className="hero-bar-fill" style={{ width: `${(powerKW / 250) * 100}%`, background: '#fbbf24' }} />
            </div>
          </div>
        </div>

        {/* Fuel Flow Card */}
        <div className="energy-hero-card glass-panel">
          <div className="card-top-row">
            <span className="card-tag text-label">FUEL BURN RATE</span>
            <LuFuel size={16} className="text-cyan" />
          </div>
          <div className="card-val-row">
            <span className="hero-val font-mono text-cyan tabular-nums">{fuelRateLph.toFixed(1)}</span>
            <span className="hero-unit">L/hr</span>
          </div>
          <div className="card-sub-info">
            <span>Daily: ~{burnRateDaily.toFixed(0)} L &bull; Autonomy: <strong>{autonomyDays} days</strong></span>
            <div className="hero-bar-track">
              <div className="hero-bar-fill" style={{ width: `${(fuelRateLph / 50) * 100}%`, background: '#38bdf8' }} />
            </div>
          </div>
        </div>

        {/* Engine Coolant Temp */}
        <div className="energy-hero-card glass-panel">
          <div className="card-top-row">
            <span className="card-tag text-label">COOLANT TEMP</span>
            <LuFlame size={16} className="text-amber" />
          </div>
          <div className="card-val-row">
            <span className="hero-val font-mono text-amber tabular-nums">{coolantTempC.toFixed(1)}</span>
            <span className="hero-unit">°C</span>
          </div>
          <div className="card-sub-info">
            <span>Operating Window: 80°C - 95°C</span>
            <div className="hero-bar-track">
              <div className="hero-bar-fill" style={{ width: `${(coolantTempC / 110) * 100}%`, background: '#f59e0b' }} />
            </div>
          </div>
        </div>

        {/* Engine RPM & Oil */}
        <div className="energy-hero-card glass-panel">
          <div className="card-top-row">
            <span className="card-tag text-label">FREQUENCY / RPM</span>
            <LuActivity size={16} className="text-emerald" />
          </div>
          <div className="card-val-row">
            <span className="hero-val font-mono text-emerald tabular-nums">{rpm.toFixed(0)}</span>
            <span className="hero-unit">RPM</span>
          </div>
          <div className="card-sub-info">
            <span>50.0 Hz Synchronized &bull; Oil: {oilPressureBar.toFixed(1)} bar</span>
            <div className="hero-bar-track">
              <div className="hero-bar-fill" style={{ width: '100%', background: '#34d399' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Split: Load Breakdown & Heat Exchanger Loop */}
      <div className="energy-split-grid">
        {/* Electrical Load Distribution */}
        <div className="energy-subpanel glass-panel">
          <div className="subpanel-header">
            <LuGauge size={16} className="text-warning" />
            <h3 className="subpanel-title font-display">Bus Load Distribution</h3>
          </div>
          <div className="load-bars-list">
            {loadBreakdown.map((item) => (
              <div key={item.label} className="load-bar-item">
                <div className="load-item-header">
                  <span className="load-item-name">{item.label}</span>
                  <span className="load-item-val font-mono">
                    {item.kw.toFixed(1)} kW <small>({item.pct}%)</small>
                  </span>
                </div>
                <div className="load-track">
                  <div
                    className="load-fill"
                    style={{ width: `${item.pct}%`, background: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Combined Heat & Power (CHP) Thermal Loop */}
        <div className="energy-subpanel glass-panel">
          <div className="subpanel-header">
            <LuThermometerSnowflake size={16} className="text-cyan" />
            <h3 className="subpanel-title font-display">Thermal Heat Recovery (CHP)</h3>
          </div>
          <div className="chp-details">
            <div className="chp-metric-row">
              <span className="chp-label">Exhaust Heat Exchanger Efficiency</span>
              <span className="chp-val font-mono text-success">88.4%</span>
            </div>
            <div className="chp-metric-row">
              <span className="chp-label">Recovered Thermal Output</span>
              <span className="chp-val font-mono text-cyan">142 kW (Thermal)</span>
            </div>
            <div className="chp-metric-row">
              <span className="chp-label">Glycol Loop Flow Rate</span>
              <span className="chp-val font-mono">48.2 L/min @ 68°C</span>
            </div>
            <div className="chp-metric-row">
              <span className="chp-label">Habitat Trace Heating Status</span>
              <span className="chp-val font-mono text-success">Active / Regulated</span>
            </div>
          </div>
          <div className="chp-efficiency-box">
            <span className="chp-note">
              &bull; Heat recovered from generator exhaust jacket prevents freezing of living quarters potable water circuits without extra fuel consumption.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
