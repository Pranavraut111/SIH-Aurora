/* ═══════════════════════════════════════════════════════════════
   Aurora — Antarctic Digital Twin (Mission Control Platform)
   Command Center Architecture:
   - Compact Top Application Header (Branding, Station, Active Page, Status)
   - Left Collapsible Sidebar (Primary Navigation)
   - Main Stage (Flexbox 100% fill, 3D Digital Twin or Full Module Views)
   ═══════════════════════════════════════════════════════════════ */
import { useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import StationScene from './components/StationScene';
import TopBar from './components/TopBar';
import SidebarNav from './components/SidebarNav';
import OverviewHUD from './components/OverviewHUD';
import BuildingPanel from './components/BuildingPanel';
import AlertFeed from './components/AlertFeed';
import ConnectionPanel from './components/ConnectionPanel';
import DemoControl from './components/DemoControl';
import AiPanel from './components/AiPanel';
import EventTimeline from './components/EventTimeline';
import TwinInspector from './components/TwinInspector';
import EnvironmentalPanel from './components/EnvironmentalPanel';
import WhatIfSimulationPanel from './components/WhatIfSimulationPanel';
import LogisticsPanel from './components/LogisticsPanel';
import RemoteControlPanel from './components/RemoteControlPanel';
import AdminPanel from './components/AdminPanel';
import ReportPanel from './components/ReportPanel';
import {
  InfrastructurePanel,
  EnergyPanel,
} from './components/ModulePanels';
import { useStationData } from './hooks/useStationData';
import { useDatabase } from './hooks/useDatabase';
import { getActiveAlerts } from './data/stationData';
import { trackModuleView, trackBuildingView, trackConnectionToggle, trackStationSwitch } from './services/analyticsService';
import './App.css';

export default function App() {
  // ── State ──────────────────────────────────────────────────
  const [activeModule, setActiveModule] = useState('overview');
  const [activeStation, setActiveStation] = useState('maitri');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [hoveredBuilding, setHoveredBuilding] = useState(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showTwinInspector, setShowTwinInspector] = useState(false);
  const [showConnectionDrawer, setShowConnectionDrawer] = useState(false);
  const [showAlertsDrawer, setShowAlertsDrawer] = useState(false);

  // ── Live data (station-aware) ─────────────────────────────
  const { stationData, dataSource, toggleConnection, acknowledgeAlert } = useStationData(activeStation);

  // ── Database persistence ──────────────────────────────────
  useDatabase(activeStation, stationData);

  // ── Derived state ────────────────────────────────────────
  const activeAlerts = stationData.activeAlerts?.length > 0
    ? stationData.activeAlerts
    : getActiveAlerts(stationData);
  const criticalCount = activeAlerts.filter(a => a.level === 'critical').length;
  const isConnected = stationData.connected !== undefined ? stationData.connected : true;
  const bandwidthSaved = stationData.bandwidth?.savedKB || 0;
  const aiHealth = stationData.aiHealth || 'healthy';
  const dependencyAlerts = stationData.dependencyAlerts || [];
  const eventTimeline = stationData.eventTimeline || [];

  // ── Handlers ──────────────────────────────────────────────
  const handleBuildingClick = useCallback((buildingId) => {
    setSelectedBuilding(prev => {
      const next = prev === buildingId ? null : buildingId;
      if (next) trackBuildingView(next, activeStation);
      return next;
    });
  }, [activeStation]);

  const handleBuildingHover = useCallback((buildingId) => {
    setHoveredBuilding(buildingId);
  }, []);

  const handleModuleChange = useCallback((moduleId) => {
    setActiveModule(moduleId);
    setSelectedBuilding(null);
    trackModuleView(moduleId, activeStation);
  }, [activeStation]);

  const handleToggleConnection = useCallback(() => {
    toggleConnection();
    trackConnectionToggle(!isConnected);
  }, [toggleConnection, isConnected]);

  const handleAlertClick = useCallback((buildingId) => {
    setSelectedBuilding(buildingId);
  }, []);

  // ── Render module panel ───────────────────────────────────
  function renderModulePanel() {
    switch (activeModule) {
      case 'environmental':
        return (
          <EnvironmentalPanel
            sensorData={stationData.sensors}
            activeStation={activeStation}
          />
        );
      case 'infrastructure':
        return (
          <InfrastructurePanel
            sensorData={stationData.sensors}
            alerts={stationData.alerts}
            onBuildingClick={handleBuildingClick}
            dependencyAlerts={dependencyAlerts}
            aiHealth={aiHealth}
          />
        );
      case 'energy':
        return (
          <EnergyPanel
            sensorData={stationData.sensors}
            alerts={stationData.alerts}
          />
        );
      case 'logistics':
        return (
          <LogisticsPanel
            activeStation={activeStation}
            sensorData={stationData.sensors}
          />
        );
      case 'simulation':
        return (
          <WhatIfSimulationPanel
            activeStation={activeStation}
            sensorData={stationData.sensors}
          />
        );
      case 'reports':
        return (
          <ReportPanel
            activeStation={activeStation}
            sensorData={stationData.sensors}
          />
        );
      case 'remote':
        return (
          <RemoteControlPanel
            activeStation={activeStation}
            sensorData={stationData.sensors}
            onAcknowledgeAlert={acknowledgeAlert}
          />
        );
      case 'admin':
        return (
          <AdminPanel
            activeStation={activeStation}
          />
        );
      case 'ai':
        return <AiPanel activeStation={activeStation} />;
      default:
        return null;
    }
  }

  return (
    <div className="aurora-app">
      {/* Ambient background gradient blobs */}
      <div className="ambient-bg">
        <div className="ambient-blob blob-1" />
        <div className="ambient-blob blob-2" />
        <div className="ambient-blob blob-3" />
      </div>
      <div className="noise-overlay" />

      {/* Top Application Header */}
      <TopBar
        activeModule={activeModule}
        activeStation={activeStation}
        onStationChange={(newStation) => {
          trackStationSwitch(activeStation, newStation);
          setActiveStation(newStation);
        }}
        alertCount={activeAlerts.length}
        criticalCount={criticalCount}
        isConnected={isConnected}
        onToggleConnection={handleToggleConnection}
        onOpenConnectionDrawer={() => setShowConnectionDrawer(true)}
        onOpenAlertsDrawer={() => setShowAlertsDrawer(true)}
        onOpenTwinInspector={() => setShowTwinInspector(true)}
        bandwidthSaved={bandwidthSaved}
        signalQuality={stationData.signalQuality}
        onTimelineToggle={() => setShowTimeline(prev => !prev)}
        showTimeline={showTimeline}
      />

      {/* App Body Layout: Sidebar + Main Content Area */}
      <div className="app-layout-body">
        {/* Collapsible Left Sidebar (Primary Navigation) */}
        <SidebarNav
          activeModule={activeModule}
          onModuleChange={handleModuleChange}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
          alertCount={activeAlerts.length}
        />

        {/* Main Viewport Stage */}
        <main className="main-stage">
          {activeModule === 'overview' ? (
            <div className="overview-stage">
              {/* 3D Twin Scene — Centerpiece */}
              <div className="scene-container">
                <StationScene
                  alertStates={stationData.alerts}
                  selectedBuilding={selectedBuilding}
                  onBuildingClick={handleBuildingClick}
                  onBuildingHover={handleBuildingHover}
                />
              </div>

              {/* Docked Overview HUD */}
              <OverviewHUD
                sensorData={stationData.sensors}
                alerts={stationData.alerts}
                activeStation={activeStation}
                isConnected={isConnected}
                onOpenTwinInspector={() => setShowTwinInspector(true)}
              />
            </div>
          ) : (
            <div className="module-content-scroll">
              <AnimatePresence mode="wait">
                {renderModulePanel()}
              </AnimatePresence>
            </div>
          )}
        </main>
      </div>

      {/* ── Contextual Drawers & Modals (Zero Collision) ── */}

      {/* Satellite Link Drawer */}
      <ConnectionPanel
        isOpen={showConnectionDrawer}
        onClose={() => setShowConnectionDrawer(false)}
        isConnected={isConnected}
        onToggleConnection={handleToggleConnection}
        bandwidthSaved={bandwidthSaved}
        offlineQueueSize={stationData.offlineQueueSize || 0}
        dataSource={dataSource}
        signalQuality={stationData.signalQuality}
        bandwidth={stationData.bandwidth}
      />

      {/* Active Alerts Drawer */}
      <AlertFeed
        isOpen={showAlertsDrawer}
        onClose={() => setShowAlertsDrawer(false)}
        alerts={activeAlerts}
        onAlertClick={handleAlertClick}
      />

      {/* Building Detail Slide-in Panel */}
      <AnimatePresence>
        {selectedBuilding && (
          <BuildingPanel
            buildingId={selectedBuilding}
            sensorData={stationData.sensors[selectedBuilding]}
            historyData={stationData.history?.[selectedBuilding]}
            alertLevel={stationData.alerts?.[selectedBuilding]}
            onClose={() => setSelectedBuilding(null)}
          />
        )}
      </AnimatePresence>

      {/* Event Timeline Modal */}
      <AnimatePresence>
        {showTimeline && (
          <EventTimeline
            events={eventTimeline}
            onClose={() => setShowTimeline(false)}
          />
        )}
      </AnimatePresence>

      {/* Digital Twin Inspector Modal */}
      <TwinInspector
        activeStation={activeStation}
        isOpen={showTwinInspector}
        onClose={() => setShowTwinInspector(false)}
      />

      {/* Demo Control Anomaly Trigger Tool */}
      <DemoControl activeStation={activeStation} />
    </div>
  );
}
