/* ═══════════════════════════════════════════════════════════════
   Aurora — Infrastructure & Energy Grid Dashboards (SIH 26060)
   Structured mission control views with live telemetry,
   equipment status matrix, interactive dependency graph, and microgrid flow.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { apiGet } from '../services/api';
import { usePolling } from '../hooks/usePolling';
import { motion } from 'framer-motion';
import { BUILDINGS } from '../data/stationData';
import DependencyGraph from './DependencyGraph';
import {
  LuBuilding2,
  LuZap,
  LuCpu,
  LuLayers,
  LuGauge,
  LuFlame,
  LuActivity,
  LuDroplets,
  LuRadio,
  LuFuel,
  LuThermometerSnowflake,
} from 'react-icons/lu';
import './ModulePanels.css';

// ── Building Status Card ──────────────────────────────────────
function BuildingCard({ buildingId, building, sensors = {}, alertLevel = 'normal', onClick }) {
  const sensorEntries = Object.entries(sensors);

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
export function InfrastructurePanel({ sensorData = {}, alerts = {}, onBuildingClick, dependencyAlerts = [], aiHealth = 'healthy', activeStation = 'maitri' }) {
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
          stationId={activeStation}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ENERGY GRID DASHBOARD
// ═══════════════════════════════════════════════════════════════
export function EnergyPanel({ sensorData = {}, activeStation = 'maitri', telemetrySource }) {
  // Live telemetry (simulator batch or physics fallback). No defaults: missing = "—".
  const genData = sensorData.generator || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const powerKW = num(genData.gen_power);
  const fuelRateLph = num(genData.gen_fuel_rate);
  const rpm = num(genData.gen_rpm);
  const coolantTempC = num(genData.gen_temp);

  // Physics-model breakdown for the same station (one twin-inspector schema)
  const [twin, setTwin] = useState({ station: null, data: null, error: null });
  // Fuel stock comes from the operator-entered logistics ledger, not a constant
  const [fuel, setFuel] = useState({ station: null, item: null, error: null });
  usePolling(async (isActive) => {
    let failed = null;
    try {
      const data = await apiGet(`/twin-inspector?stationId=${activeStation}`);
      if (isActive()) setTwin({ station: activeStation, data, error: null });
    } catch (err) {
      console.error('[EnergyPanel] twin-inspector failed', err);
      if (isActive()) setTwin({ station: activeStation, data: null, error: err });
      failed = err;
    }
    try {
      const inv = await apiGet(`/logistics?stationId=${activeStation}`);
      const item = (inv.items || []).find((i) => i.id === `${activeStation}-fuel`) || null;
      if (isActive()) setFuel({ station: activeStation, item, error: null });
    } catch (err) {
      console.error('[EnergyPanel] logistics failed', err);
      if (isActive()) setFuel({ station: activeStation, item: null, error: err });
      failed = failed || err;
    }
    if (failed) throw failed;           // let usePolling back off
  }, 5000, { key: activeStation });

  const twinData = twin.station === activeStation ? twin.data : null;
  const twinError = twin.station === activeStation ? twin.error : null;
  const fuelItem = fuel.station === activeStation ? fuel.item : null;
  const gm = twinData?.generatorModel || {};
  const ratedKW = num(gm.maxPower_kW);
  const loadPct = num(gm.loadFactor_pct) ?? (powerKW != null && ratedKW ? (powerKW / ratedKW) * 100 : null);
  const pb = twinData?.powerBreakdown || {};
  const totalDemand = num(pb.total_demand_kW);
  const loadBreakdown = [
    { label: 'Base electrical (buildings)', kw: num(pb.base_electrical_kW), color: '#38bdf8' },
    { label: 'Electrical heating', kw: num(pb.heating_electrical_kW), color: '#fbbf24' },
    { label: 'Water treatment', kw: num(pb.water_treatment_kW), color: '#34d399' },
    { label: 'Communications', kw: num(pb.comms_kW), color: '#a78bfa' },
    { label: 'Ventilation', kw: num(pb.ventilation_kW), color: '#f472b6' },
  ];

  const burnRateDaily = fuelRateLph != null ? fuelRateLph * 24 : null;
  const fuelStockL = fuelItem && fuelItem.unit === 'L' ? fuelItem.current : null;
  const autonomyDays = fuelStockL != null && burnRateDaily ? Math.floor(fuelStockL / burnRateDaily) : null;
  const f = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
  const sourceLabel = telemetrySource === 'simulator' ? 'LIVE SIMULATOR · MODEL-DERIVED'
    : telemetrySource === 'physics-fallback' ? 'PHYSICS FALLBACK · MODEL-DERIVED'
      : telemetrySource === 'browser-demo' ? 'BROWSER DEMO · SIMULATED' : 'NO TELEMETRY';

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
              <h1 className="energy-title font-display">Microgrid & Power</h1>
              <span className="energy-badge-active">{sourceLabel}</span>
            </div>
            <p className="energy-subtitle">
              Generator values from telemetry; load split from the physics model (Willans-line fuel model, estimated parameters).
            </p>
          </div>
        </div>

        <div className="energy-header-status">
          <span className="gen-status-pill standby">
            Single modelled generator · second gen-set not modelled
          </span>
        </div>
      </div>

      {/* Hero Metrics Row */}
      <div className="energy-hero-grid">
        <div className="energy-hero-card glass-panel">
          <div className="card-top-row">
            <span className="card-tag text-label">TOTAL GENERATION</span>
            <LuZap size={16} className="text-warning" />
          </div>
          <div className="card-val-row">
            <span className="hero-val font-mono text-warning tabular-nums">{f(powerKW, 0)}</span>
            <span className="hero-unit">kW</span>
          </div>
          <div className="card-sub-info">
            <span>Rated (model): {ratedKW != null ? `${ratedKW} kW` : '—'} · load {loadPct != null ? `${loadPct.toFixed(0)}%` : '—'}</span>
            <div className="hero-bar-track">
              <div className="hero-bar-fill" style={{ width: `${Math.min(100, loadPct ?? 0)}%`, background: '#fbbf24' }} />
            </div>
          </div>
        </div>

        <div className="energy-hero-card glass-panel">
          <div className="card-top-row">
            <span className="card-tag text-label">FUEL BURN RATE</span>
            <LuFuel size={16} className="text-cyan" />
          </div>
          <div className="card-val-row">
            <span className="hero-val font-mono text-cyan tabular-nums">{f(fuelRateLph)}</span>
            <span className="hero-unit">L/hr</span>
          </div>
          <div className="card-sub-info">
            <span>
              Daily: {burnRateDaily != null ? `~${burnRateDaily.toFixed(0)} L` : '—'} &bull; Stock (logistics ledger):{' '}
              {fuelStockL != null ? `${fuelStockL.toLocaleString()} L` : fuel.error ? 'backend unreachable' : '—'} &bull;
              Autonomy: <strong>{autonomyDays != null ? `${autonomyDays} days` : '—'}</strong>
            </span>
          </div>
        </div>

        <div className="energy-hero-card glass-panel">
          <div className="card-top-row">
            <span className="card-tag text-label">COOLANT TEMP</span>
            <LuFlame size={16} className="text-amber" />
          </div>
          <div className="card-val-row">
            <span className="hero-val font-mono text-amber tabular-nums">{f(coolantTempC)}</span>
            <span className="hero-unit">°C</span>
          </div>
          <div className="card-sub-info">
            <span>Model-derived coolant temperature</span>
            <div className="hero-bar-track">
              <div className="hero-bar-fill" style={{ width: `${Math.min(100, ((coolantTempC ?? 0) / 110) * 100)}%`, background: '#f59e0b' }} />
            </div>
          </div>
        </div>

        <div className="energy-hero-card glass-panel">
          <div className="card-top-row">
            <span className="card-tag text-label">ENGINE RPM</span>
            <LuActivity size={16} className="text-emerald" />
          </div>
          <div className="card-val-row">
            <span className="hero-val font-mono text-emerald tabular-nums">{f(rpm, 0)}</span>
            <span className="hero-unit">RPM</span>
          </div>
          <div className="card-sub-info">
            <span>Oil pressure / vibration / bus frequency: not modelled</span>
          </div>
        </div>
      </div>

      {/* Bottom Split: Load Breakdown & Heat */}
      <div className="energy-split-grid">
        <div className="energy-subpanel glass-panel">
          <div className="subpanel-header">
            <LuGauge size={16} className="text-warning" />
            <h3 className="subpanel-title font-display">Electrical demand breakdown (physics model)</h3>
          </div>
          {twinError ? (
            <p className="chp-note">Backend unreachable — physics breakdown unavailable.</p>
          ) : !totalDemand ? (
            <p className="chp-note">Waiting for physics model…</p>
          ) : (
            <div className="load-bars-list">
              {loadBreakdown.map((item) => {
                const pct = item.kw != null ? (item.kw / totalDemand) * 100 : 0;
                return (
                  <div key={item.label} className="load-bar-item">
                    <div className="load-item-header">
                      <span className="load-item-name">{item.label}</span>
                      <span className="load-item-val font-mono">
                        {f(item.kw)} kW <small>({pct.toFixed(0)}%)</small>
                      </span>
                    </div>
                    <div className="load-track">
                      <div className="load-fill" style={{ width: `${pct}%`, background: item.color }} />
                    </div>
                  </div>
                );
              })}
              <div className="load-item-header">
                <span className="load-item-name">Total demand</span>
                <span className="load-item-val font-mono">{f(totalDemand)} kW</span>
              </div>
            </div>
          )}
        </div>

        <div className="energy-subpanel glass-panel">
          <div className="subpanel-header">
            <LuThermometerSnowflake size={16} className="text-cyan" />
            <h3 className="subpanel-title font-display">Heating & waste-heat recovery (physics model)</h3>
          </div>
          <div className="chp-details">
            <div className="chp-metric-row">
              <span className="chp-label">Total building heat loss</span>
              <span className="chp-val font-mono">{f(num(twinData?.totalHeatLoss_kW))} kW</span>
            </div>
            <div className="chp-metric-row">
              <span className="chp-label">Heating demand</span>
              <span className="chp-val font-mono">{f(num(twinData?.heatingDemand_kW))} kW</span>
            </div>
            <div className="chp-metric-row">
              <span className="chp-label">Waste-heat recovery share (assumed)</span>
              <span className="chp-val font-mono">{twinData?.wasteHeatRecovery != null ? `${(twinData.wasteHeatRecovery * 100).toFixed(0)}%` : '—'}</span>
            </div>
            <div className="chp-metric-row">
              <span className="chp-label">Distribution efficiency (estimated)</span>
              <span className="chp-val font-mono">{twinData?.heatingEfficiency != null ? `${(twinData.heatingEfficiency * 100).toFixed(0)}%` : '—'}</span>
            </div>
            <div className="chp-metric-row">
              <span className="chp-label">Glycol loop flow / exchanger efficiency</span>
              <span className="chp-val font-mono text-muted">not modelled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
