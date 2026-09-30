/* ═══════════════════════════════════════════════════════════════
   Aurora — Top Application Header (Mission Control Edition)
   Clean compact header:
   - AURORA | Antarctic Digital Twin (NO SIH badge)
   - Station Selector Dropdown (Maitri / Bharati)
   - Active Module Title & Badge
   - Global Telemetry Status, Satellite Link & Twin Inspector
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuSnowflake,
  LuChevronDown,
  LuMapPin,
  LuTriangleAlert,
  LuGauge,
  LuSatelliteDish,
  LuSparkles,
  LuClock,
  LuUnplug,
  LuPlug,
  LuLayoutDashboard,
  LuThermometerSnowflake,
  LuBuilding2,
  LuZap,
  LuPackage,
  LuRadioTower,
  LuSlidersHorizontal,
  LuFileText,
  LuSettings,
} from 'react-icons/lu';
import './TopBar.css';

const MODULE_META = {
  overview: {
    title: 'Mission Overview',
    subtitle: '3D Digital Twin Command Center',
    IconComp: LuLayoutDashboard,
    color: '#58a6ff',
  },
  environmental: {
    title: 'NCPOR Weather',
    subtitle: 'AWS Polar Observations & Scientific Feeds',
    IconComp: LuThermometerSnowflake,
    color: '#38bdf8',
  },
  infrastructure: {
    title: 'Station Infrastructure',
    subtitle: 'Facility Telemetry & Cascading Dependency Matrix',
    IconComp: LuBuilding2,
    color: '#a78bfa',
  },
  energy: {
    title: 'Energy Grid & Microgrid',
    subtitle: 'Diesel Gen-Sets, Fuel Autonomy & Thermal Loop',
    IconComp: LuZap,
    color: '#fbbf24',
  },
  logistics: {
    title: 'Logistics & Supply',
    subtitle: 'Depot Stock, Life Support Consumables & Voyages',
    IconComp: LuPackage,
    color: '#34d399',
  },
  simulation: {
    title: 'What-If Simulation',
    subtitle: 'Physical Stress Scenarios & Cascade Impact Engine',
    IconComp: LuSlidersHorizontal,
    color: '#c084fc',
  },
  reports: {
    title: 'Station Reports',
    subtitle: 'NCPOR Operations Dossier & PDF Export',
    IconComp: LuFileText,
    color: '#60a5fa',
  },
  remote: {
    title: 'Remote C&C',
    subtitle: 'Satellite Command Telemetry & Safety Overrides',
    IconComp: LuRadioTower,
    color: '#38bdf8',
  },
  admin: {
    title: 'System Admin',
    subtitle: 'Operational Parameters & Sensor Thresholds',
    IconComp: LuSettings,
    color: '#94a3b8',
  },
  ai: {
    title: 'AI Diagnostics',
    subtitle: 'Physics-Informed LSTM Neural Residuals',
    IconComp: LuSparkles,
    color: '#f472b6',
  },
};

export default function TopBar({
  activeModule = 'overview',
  activeStation = 'maitri',
  onStationChange,
  alertCount = 0,
  criticalCount = 0,
  isConnected = true,
  onToggleConnection,
  onOpenConnectionDrawer,
  onOpenAlertsDrawer,
  onOpenTwinInspector,
  bandwidthSaved = 0,
  onTimelineToggle,
  showTimeline,
}) {
  const [showStationMenu, setShowStationMenu] = useState(false);
  const currentMeta = MODULE_META[activeModule] || MODULE_META.overview;

  return (
    <header className="topbar">
      {/* ── Left: Aurora Branding (NO SIH 26060 badge) ──────── */}
      <div className="topbar-left">
        <div className="topbar-brand">
          <span className="logo-glyph">
            <img src="/logo.jpeg" alt="Aurora" className="logo-img" />
          </span>
          <div className="logo-text">
            <span className="logo-name font-display">AURORA</span>
            <span className="logo-tagline">ANTARCTIC DIGITAL TWIN</span>
          </div>
        </div>

        <div className="topbar-divider" />

        {/* ── Station Selector Dropdown ──────────────────────── */}
        <div className="station-selector-wrapper">
          <button
            className="station-selector-btn"
            onClick={() => setShowStationMenu(!showStationMenu)}
            title="Switch Antarctic Station"
          >
            <LuMapPin size={14} className="station-pin-icon" />
            <span className="station-active font-display">
              {activeStation === 'maitri' ? 'Maitri Station' : 'Bharati Station'}
            </span>
            <span className="station-coords font-mono">
              {activeStation === 'maitri' ? '70.77°S, 11.73°E' : '69.41°S, 76.19°E'}
            </span>
            <LuChevronDown
              size={13}
              className={`station-chevron ${showStationMenu ? 'open' : ''}`}
            />
          </button>

          <AnimatePresence>
            {showStationMenu && (
              <motion.div
                className="station-dropdown glass-panel"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15 }}
              >
                <button
                  className={`station-option ${activeStation === 'maitri' ? 'active' : ''}`}
                  onClick={() => {
                    onStationChange('maitri');
                    setShowStationMenu(false);
                  }}
                >
                  <div className="station-option-content">
                    <div className="station-opt-title font-display">Maitri Research Station</div>
                    <div className="station-opt-sub font-mono">Schirmacher Oasis (70.77°S, 11.73°E) &bull; Est. 1989</div>
                  </div>
                  {activeStation === 'maitri' && <span className="station-opt-check">&bull;</span>}
                </button>
                <button
                  className={`station-option ${activeStation === 'bharati' ? 'active' : ''}`}
                  onClick={() => {
                    onStationChange('bharati');
                    setShowStationMenu(false);
                  }}
                >
                  <div className="station-option-content">
                    <div className="station-opt-title font-display">Bharati Research Station</div>
                    <div className="station-opt-sub font-mono">Larsemann Hills (69.41°S, 76.19°E) &bull; Est. 2012</div>
                  </div>
                  {activeStation === 'bharati' && <span className="station-opt-check">&bull;</span>}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="topbar-divider" />

        {/* ── Active Module Identification ──────────────────── */}
        <div className="current-page-badge" style={{ '--badge-color': currentMeta.color }}>
          <div className="page-badge-icon" style={{ color: currentMeta.color }}>
            <currentMeta.IconComp size={15} strokeWidth={2} />
          </div>
          <div className="page-badge-info">
            <span className="page-badge-title font-display">{currentMeta.title}</span>
            <span className="page-badge-sub">{currentMeta.subtitle}</span>
          </div>
        </div>
      </div>

      {/* ── Right: Telemetry Status, Inspector & Actions ────── */}
      <div className="topbar-right">
        {/* Bandwidth Delta-Saved Pill */}
        <div className="status-pill bandwidth" title="Bandwidth saved via delta-compression over satellite link">
          <LuGauge size={13} />
          <span className="pill-value font-mono tabular-nums">{bandwidthSaved.toFixed(1)}</span>
          <span className="pill-unit">KB Saved</span>
        </div>

        {/* Digital Twin Inspector Trigger Button */}
        <button
          className="topbar-btn twin-inspector-trigger"
          onClick={onOpenTwinInspector}
          title="Open 3D Digital Twin Subsystem Inspector"
        >
          <LuSparkles size={13} className="icon-sparkle" />
          <span>Twin Inspector</span>
        </button>

        {/* Active Alerts Pill */}
        <button
          className={`status-pill alerts ${alertCount > 0 ? (criticalCount > 0 ? 'critical' : 'warning') : 'normal'}`}
          onClick={onOpenAlertsDrawer}
          title={alertCount > 0 ? `${alertCount} Active Alert(s) — Click to view` : 'All Systems Nominal'}
        >
          <LuTriangleAlert size={13} />
          <span className="pill-value font-mono tabular-nums">
            {alertCount > 0 ? `${alertCount} Alert${alertCount > 1 ? 's' : ''}` : 'Nominal'}
          </span>
          {alertCount > 0 && <span className="alert-pulse-dot" />}
        </button>

        {/* Satellite Link Status Pill */}
        <button
          className={`status-pill connection ${isConnected ? 'connected' : 'disconnected'}`}
          onClick={onOpenConnectionDrawer}
          title="Iridium Satellite Telemetry Channel — Click to view link drawer"
        >
          <LuSatelliteDish size={13} />
          <span className="connection-dot" />
          <span className="pill-label font-mono">
            {isConnected ? 'ONLINE (NCPOR)' : 'LINK LOST'}
          </span>
        </button>

        {/* Quick Link Toggle */}
        <button
          className={`topbar-icon-btn ${isConnected ? 'btn-link-active' : 'btn-link-offline'}`}
          onClick={onToggleConnection}
          title={isConnected ? 'Simulate Satellite Link Loss' : 'Restore Satellite Link'}
        >
          {isConnected ? <LuPlug size={14} /> : <LuUnplug size={14} />}
        </button>

        {/* Event Timeline Toggle */}
        <button
          className={`topbar-icon-btn ${showTimeline ? 'active' : ''}`}
          onClick={onTimelineToggle}
          title="Station Event Timeline"
        >
          <LuClock size={14} />
        </button>
      </div>
    </header>
  );
}
