import { useState, useEffect } from 'react';
import './TwinInspector.css';

/**
 * Digital Twin Inspector — Shows the full causal chain breakdown
 * for any building/system at the active station.
 * 
 * Includes: Environment → Thermal → Power → Generator → Provenance → Assumptions
 * Historical Replay controls for date selection + speed.
 */

const BASIS_COLORS = {
  documented: { bg: '#0d4a2e', color: '#4ade80', icon: '📄' },
  estimated:  { bg: '#4a3d0d', color: '#fbbf24', icon: '📐' },
  assumed:    { bg: '#3d1a0d', color: '#fb923c', icon: '⚙️' },
};

export default function TwinInspector({ activeStation, isOpen, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('chain'); // 'chain' | 'assumptions' | 'replay'
  const [replayDate, setReplayDate] = useState('2024-07-15');
  const [replaySpeed, setReplaySpeed] = useState(120);

  useEffect(() => {
    if (!isOpen) return;
    
    const fetchData = () => {
      setLoading(true);
      fetch(`http://localhost:8080/api/twin-inspector?station=${activeStation}`)
        .then(r => r.json())
        .then(d => { setData(d); setLoading(false); })
        .catch(() => {
          fetch(`http://localhost:8001/api/twin-inspector?station=${activeStation}`)
            .then(r => r.json())
            .then(d => { setData(d); setLoading(false); })
            .catch(() => setLoading(false));
        });
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [activeStation, isOpen]);

  if (!isOpen) return null;

  const sourceTag = (type) => {
    const colors = {
      'reanalysis': { bg: '#0d4a2e', color: '#4ade80', label: '🟢 REANALYSIS' },
      'model-derived': { bg: '#4a3d0d', color: '#fbbf24', label: '🟡 MODEL' },
      'synthetic': { bg: '#1e3a5f', color: '#60a5fa', label: '🔵 SIMULATED' },
    };
    const c = colors[type] || colors['synthetic'];
    return <span className="source-tag" style={{ background: c.bg, color: c.color }}>{c.label}</span>;
  };

  const basisTag = (basis) => {
    const c = BASIS_COLORS[basis] || BASIS_COLORS.assumed;
    return <span className="basis-tag" style={{ background: c.bg, color: c.color }}>{c.icon} {basis}</span>;
  };

  const handleReplay = () => {
    fetch('http://localhost:8001/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'reanalysis', date: replayDate, speed: replaySpeed }),
    })
      .then(r => r.json())
      .then(() => setTab('chain'))
      .catch(console.error);
  };

  const handleSwitchToSim = () => {
    fetch('http://localhost:8001/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'simulation' }),
    }).catch(console.error);
  };

  return (
    <div className="twin-inspector-overlay" onClick={onClose}>
      <div className="twin-inspector" onClick={e => e.stopPropagation()}>
        <div className="ti-header">
          <h2>⚡ Digital Twin Inspector</h2>
          <span className="ti-station">{activeStation?.toUpperCase()}</span>
          <button className="ti-close" onClick={onClose}>✕</button>
        </div>

        {/* Tab Bar */}
        <div className="ti-tabs">
          <button className={tab === 'chain' ? 'active' : ''} onClick={() => setTab('chain')}>Causal Chain</button>
          <button className={tab === 'assumptions' ? 'active' : ''} onClick={() => setTab('assumptions')}>Model Assumptions</button>
          <button className={tab === 'replay' ? 'active' : ''} onClick={() => setTab('replay')}>Historical Replay</button>
        </div>

        {loading && !data && <div className="ti-loading">Loading...</div>}

        {data && tab === 'chain' && (
          <div className="ti-content">
            {/* Data Source Banner */}
            <div className="ti-banner">
              <div className="ti-banner-label">DATA SOURCE</div>
              <div className="ti-banner-value">{data.dataSource?.label || 'Unknown'}</div>
              {data.environment?.simulatedTime && (
                <div className="ti-banner-time">
                  Simulated: {data.environment.simulatedTime.replace('T', ' ').slice(0, 16)}
                </div>
              )}
              {data.dataSource?.replay && (
                <div className="ti-progress-bar">
                  <div className="ti-progress-fill" 
                       style={{ width: `${(data.dataSource.replay.progress * 100)}%` }} />
                </div>
              )}
            </div>

            {/* ENVIRONMENT */}
            <div className="ti-section">
              <div className="ti-section-header">
                <span>ENVIRONMENT</span>
                {sourceTag(data.environment?.sourceType || 'reanalysis')}
              </div>
              <div className="ti-grid">
                <div className="ti-metric">
                  <span className="ti-label">Temperature</span>
                  <span className="ti-value">{data.environment?.temperature_C?.toFixed(1)}°C</span>
                </div>
                <div className="ti-metric">
                  <span className="ti-label">Wind</span>
                  <span className="ti-value">{data.environment?.wind_kmh?.toFixed(1)} km/h</span>
                </div>
                <div className="ti-metric">
                  <span className="ti-label">Pressure</span>
                  <span className="ti-value">{data.environment?.pressure_hPa?.toFixed(1)} hPa</span>
                </div>
                <div className="ti-metric">
                  <span className="ti-label">Humidity</span>
                  <span className="ti-value">{data.environment?.humidity_pct?.toFixed(0)}%</span>
                </div>
              </div>
            </div>

            {/* THERMAL MODEL */}
            <div className="ti-section">
              <div className="ti-section-header">
                <span>THERMAL MODEL</span>
                {sourceTag('model-derived')}
              </div>
              <div className="ti-chain"><span className="ti-chain-arrow">↓</span></div>
              <div className="ti-sub-label">Building heat loss (wind contributes to modeled envelope losses)</div>
              {data.thermalModel && Object.entries(data.thermalModel).map(([bld, info]) => (
                <div key={bld} className="ti-building-row">
                  <span className="ti-bld-name">{bld.replace(/([A-Z])/g, ' $1').trim()}</span>
                  <span className="ti-bld-dt">ΔT: {info.delta_T?.toFixed(1)}°C</span>
                  <span className="ti-bld-loss">Loss: {info.heat_loss_kW?.toFixed(1)} kW</span>
                </div>
              ))}
              <div className="ti-total-row">
                <span>Total building heat loss</span>
                <span className="ti-total-val">{data.totalHeatLoss_kW?.toFixed(1)} kW</span>
              </div>
              {/* Explicit efficiency chain */}
              {data.heatingEfficiency && (
                <div className="ti-efficiency-chain">
                  <div className="ti-eff-row">
                    <span>Heating system efficiency</span>
                    <span className="ti-eff-val">{(data.heatingEfficiency * 100).toFixed(0)}%</span>
                    {basisTag('estimated')}
                  </div>
                  <div className="ti-eff-row result">
                    <span>Required heating output</span>
                    <span className="ti-eff-val">{data.heatingDemand_kW?.toFixed(1)} kW</span>
                  </div>
                  <div className="ti-eff-formula">
                    {data.totalHeatLoss_kW?.toFixed(1)} ÷ {data.heatingEfficiency} = {data.heatingDemand_kW?.toFixed(1)} kW
                  </div>
                </div>
              )}
            </div>

            {/* POWER MODEL */}
            <div className="ti-section">
              <div className="ti-section-header">
                <span>POWER MODEL</span>
                {sourceTag('model-derived')}
              </div>
              <div className="ti-chain"><span className="ti-chain-arrow">↓</span></div>
              {data.powerBreakdown && (
                <>
                  <div className="ti-power-row">
                    <span>Base electrical</span>
                    <span>{data.powerBreakdown.base_electrical_kW} kW</span>
                  </div>
                  <div className="ti-power-row highlight">
                    <span>Heating electrical (excl. {((data.wasteHeatRecovery || 0.15) * 100).toFixed(0)}% waste heat recovery)</span>
                    <span>{data.powerBreakdown.heating_electrical_kW} kW</span>
                  </div>
                  {data.wasteHeatRecovery != null && data.heatingDemand_kW && (
                    <div className="ti-eff-formula">
                      {data.heatingDemand_kW?.toFixed(1)} × (1 − {data.wasteHeatRecovery}) = {(data.heatingDemand_kW * (1 - data.wasteHeatRecovery)).toFixed(1)} kW
                    </div>
                  )}
                  <div className="ti-power-row">
                    <span>Water treatment</span>
                    <span>{data.powerBreakdown.water_treatment_kW} kW</span>
                  </div>
                  <div className="ti-power-row">
                    <span>Ventilation (HVAC)</span>
                    <span>{data.powerBreakdown.ventilation_kW} kW</span>
                  </div>
                  <div className="ti-power-row">
                    <span>Communications</span>
                    <span>{data.powerBreakdown.comms_kW} kW</span>
                  </div>
                  <div className="ti-total-row bold">
                    <span>Total electrical demand</span>
                    <span className="ti-total-val">{data.powerBreakdown.total_demand_kW} kW</span>
                  </div>
                </>
              )}
            </div>

            {/* GENERATOR MODEL */}
            <div className="ti-section">
              <div className="ti-section-header">
                <span>GENERATOR MODEL</span>
                {sourceTag('model-derived')}
              </div>
              <div className="ti-chain"><span className="ti-chain-arrow">↓</span></div>
              {data.generatorModel && (
                <div className="ti-grid">
                  <div className="ti-metric">
                    <span className="ti-label">Power</span>
                    <span className="ti-value">{data.generatorModel.power_kW?.toFixed(1)} kW</span>
                  </div>
                  <div className="ti-metric">
                    <span className="ti-label">Load</span>
                    <span className="ti-value">{data.generatorModel.loadFactor_pct?.toFixed(1)}%</span>
                  </div>
                  <div className="ti-metric">
                    <span className="ti-label">Temperature</span>
                    <span className="ti-value">{data.generatorModel.temperature_C?.toFixed(1)}°C</span>
                  </div>
                  <div className="ti-metric">
                    <span className="ti-label">Fuel Rate</span>
                    <span className="ti-value">{data.generatorModel.fuelRate_Lhr?.toFixed(1)} L/hr</span>
                  </div>
                  <div className="ti-metric">
                    <span className="ti-label">RPM</span>
                    <span className="ti-value">{data.generatorModel.rpm?.toFixed(0)}</span>
                  </div>
                  <div className="ti-metric">
                    <span className="ti-label">Capacity</span>
                    <span className="ti-value">{data.generatorModel.maxPower_kW} kW</span>
                  </div>
                </div>
              )}
            </div>

            {/* DATA PROVENANCE */}
            <div className="ti-section provenance">
              <div className="ti-section-header">
                <span>DATA PROVENANCE</span>
              </div>
              <div className="ti-prov-row">
                <span>Environment</span>
                {sourceTag('reanalysis')}
              </div>
              <div className="ti-prov-row">
                <span>Equipment</span>
                {sourceTag('model-derived')}
              </div>
              <div className="ti-prov-note">
                Environmental conditions from ERA5 reanalysis (ECMWF). Equipment values
                calculated by physics-based thermal, power, and generator models.
                Not direct station sensor measurements.
              </div>
            </div>
          </div>
        )}

        {/* MODEL ASSUMPTIONS TAB */}
        {data && tab === 'assumptions' && (
          <div className="ti-content">
            <div className="ti-banner">
              <div className="ti-banner-label">PARAMETER PROVENANCE</div>
              <div className="ti-banner-value">Model Assumptions — {activeStation?.toUpperCase()}</div>
              <div className="ti-banner-time">
                Each parameter classified as documented, estimated, or assumed
              </div>
            </div>

            {/* Legend */}
            <div className="ti-legend">
              <span>{BASIS_COLORS.documented.icon} <b>Documented</b> — published specs</span>
              <span>{BASIS_COLORS.estimated.icon} <b>Estimated</b> — engineering estimate</span>
              <span>{BASIS_COLORS.assumed.icon} <b>Assumed</b> — prototype assumption</span>
            </div>

            {data.modelAssumptions?.buildings && Object.entries(data.modelAssumptions.buildings).map(([bld, params]) => (
              <div key={bld} className="ti-section">
                <div className="ti-section-header">
                  <span>{bld.replace(/([A-Z])/g, ' $1').trim().toUpperCase()}</span>
                </div>
                {Object.entries(params).map(([key, info]) => (
                  <div key={key} className="ti-assumption-row">
                    <span className="ti-assume-name">{key.replace(/_/g, ' ')}</span>
                    <span className="ti-assume-val">{info.value} {info.unit}</span>
                    {basisTag(info.basis)}
                  </div>
                ))}
              </div>
            ))}

            {data.modelAssumptions?.heating && (
              <div className="ti-section">
                <div className="ti-section-header"><span>HEATING SYSTEM</span></div>
                {Object.entries(data.modelAssumptions.heating).map(([key, info]) => (
                  <div key={key} className="ti-assumption-row">
                    <span className="ti-assume-name">{key.replace(/_/g, ' ')}</span>
                    <span className="ti-assume-val">{info.value} {info.unit}</span>
                    {basisTag(info.basis)}
                    {info.note && <div className="ti-assume-note">{info.note}</div>}
                  </div>
                ))}
              </div>
            )}

            {data.modelAssumptions?.generator && (
              <div className="ti-section">
                <div className="ti-section-header"><span>GENERATOR</span></div>
                {Object.entries(data.modelAssumptions.generator).map(([key, info]) => (
                  <div key={key} className="ti-assumption-row">
                    <span className="ti-assume-name">{key.replace(/_/g, ' ')}</span>
                    <span className="ti-assume-val">{info.value} {info.unit}</span>
                    {basisTag(info.basis)}
                    {info.note && <div className="ti-assume-note">{info.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* HISTORICAL REPLAY TAB */}
        {tab === 'replay' && (
          <div className="ti-content">
            <div className="ti-banner">
              <div className="ti-banner-label">HISTORICAL REPLAY</div>
              <div className="ti-banner-value">Select a date to replay ERA5 weather through the digital twin</div>
            </div>

            <div className="ti-section">
              <div className="ti-section-header"><span>REPLAY SETTINGS</span></div>
              
              <div className="ti-replay-field">
                <label>Start Date</label>
                <input
                  type="date"
                  value={replayDate}
                  onChange={e => setReplayDate(e.target.value)}
                  max="2026-09-20"
                  min="2020-01-01"
                />
              </div>

              <div className="ti-replay-field">
                <label>Speed Factor</label>
                <div className="ti-speed-options">
                  {[60, 120, 360, 720].map(s => (
                    <button
                      key={s}
                      className={replaySpeed === s ? 'active' : ''}
                      onClick={() => setReplaySpeed(s)}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
                <div className="ti-speed-note">
                  {replaySpeed}× = {(replaySpeed * 2 / 3600).toFixed(1)} simulated hours per real minute
                </div>
              </div>

              <button className="ti-replay-btn" onClick={handleReplay}>
                ▶ Start Replay
              </button>

              <div className="ti-replay-info">
                Downloads 7 days of ERA5 reanalysis data from the selected date,
                caches locally, then replays through the physics-based digital twin
                at the selected speed. Both Maitri and Bharati reset simultaneously.
              </div>
            </div>

            <div className="ti-section">
              <div className="ti-section-header"><span>MODE SWITCH</span></div>
              <div className="ti-mode-btns">
                <button className="ti-mode-btn era5" onClick={handleReplay}>
                  🟢 ERA5 Reanalysis
                </button>
                <button className="ti-mode-btn sim" onClick={handleSwitchToSim}>
                  🔵 Developer/Test Mode
                </button>
              </div>
            </div>

            {data?.dataSource?.replay && (
              <div className="ti-section">
                <div className="ti-section-header"><span>CURRENT REPLAY STATUS</span></div>
                <div className="ti-power-row">
                  <span>Mode</span><span>{data.mode}</span>
                </div>
                <div className="ti-power-row">
                  <span>Speed</span><span>{data.dataSource.replay.speed_factor}×</span>
                </div>
                <div className="ti-power-row">
                  <span>Progress</span><span>{(data.dataSource.replay.progress * 100).toFixed(1)}%</span>
                </div>
                <div className="ti-power-row">
                  <span>Simulated</span><span>{data.dataSource.replay.simulated_hours?.toFixed(1)}h of {data.dataSource.replay.total_hours}h</span>
                </div>
                <div className="ti-power-row">
                  <span>Date Range</span><span style={{fontSize: '10px'}}>{data.dataSource.replay.date_range}</span>
                </div>
                <div className="ti-progress-bar" style={{marginTop: '8px'}}>
                  <div className="ti-progress-fill" style={{ width: `${data.dataSource.replay.progress * 100}%` }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
