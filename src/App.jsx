/* ═══════════════════════════════════════════════════════════════
   Aurora — Antarctic station digital twin.
   App shell (docs/ui-redesign.md §4): ONE top bar (station switcher, status
   chips, Sign in), sectioned sidebar with the station mini-card, and the main
   stage — the 3D overview or one module page.
   ═══════════════════════════════════════════════════════════════ */
import { useState, useCallback, lazy, Suspense } from 'react';
import { useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ErrorBoundary from './components/ErrorBoundary';
import PanelFallback from './components/PanelFallback';
import TopBar from './shell/TopBar';
import SideNav from './shell/SideNav';
import { MODULES } from './shell/navigation';
import LegacySurface from './ui/LegacySurface';
import { useStationData } from './hooks/useStationData';
import { useDatabase } from './hooks/useDatabase';
import { trackModuleView, trackBuildingView, trackConnectionToggle, trackStationSwitch } from './services/analyticsService';
import './App.css';

// ── Code splitting ─────────────────────────────────────────
// Everything below is fetched only when it is first shown, which keeps three.js
// (the 3D twin), recharts (the charts) and the legacy overlays (with framer-motion
// and react-icons) out of the initial bundle — the main chunk stays under 500 kB.
const OverviewHUD = lazy(() => import('./components/OverviewHUD'));
const AlertFeed = lazy(() => import('./components/AlertFeed'));
const ConnectionPanel = lazy(() => import('./components/ConnectionPanel'));
const DemoControl = lazy(() => import('./components/DemoControl'));
const StationScene = lazy(() => import('./components/StationScene'));
const BuildingPanel = lazy(() => import('./components/BuildingPanel'));
const EventTimeline = lazy(() => import('./components/EventTimeline'));
const TwinInspector = lazy(() => import('./components/TwinInspector'));
const AiPanel = lazy(() => import('./components/AiPanel'));
const EnvironmentalPanel = lazy(() => import('./components/EnvironmentalPanel'));
const WhatIfSimulationPanel = lazy(() => import('./components/WhatIfSimulationPanel'));
const LogisticsPanel = lazy(() => import('./components/LogisticsPanel'));
const RemoteControlPanel = lazy(() => import('./components/RemoteControlPanel'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const ReportPanel = lazy(() => import('./components/ReportPanel'));
const InfrastructurePanel = lazy(() =>
  import('./components/ModulePanels').then((m) => ({ default: m.InfrastructurePanel })));
const EnergyModule = lazy(() => import('./modules/energy/EnergyModule'));

export default function App() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });

  // ── State ──────────────────────────────────────────────────
  const [activeModule, setActiveModule] = useState('overview');
  const [activeStation, setActiveStation] = useState('maitri');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [, setHoveredBuilding] = useState(null);   // hover is tracked by the scene; no consumer yet
  const [showTimeline, setShowTimeline] = useState(false);
  const [showTwinInspector, setShowTwinInspector] = useState(false);
  const [showConnectionDrawer, setShowConnectionDrawer] = useState(false);
  const [showAlertsDrawer, setShowAlertsDrawer] = useState(false);
  // Drawers are mounted on first open (their chunks load then) and stay mounted so
  // their own close animation still runs.
  const [showDemo, setShowDemo] = useState(false);
  const [mounted, setMounted] = useState({ alerts: false, link: false, demo: false });
  const openAlerts = useCallback(() => { setMounted((m) => ({ ...m, alerts: true })); setShowAlertsDrawer(true); }, []);
  const openLink = useCallback(() => { setMounted((m) => ({ ...m, link: true })); setShowConnectionDrawer(true); }, []);
  const toggleDemo = useCallback(() => { setMounted((m) => ({ ...m, demo: true })); setShowDemo((v) => !v); }, []);
  const closeDemo = useCallback(() => setShowDemo(false), []);

  // ── Live data (station-aware) ─────────────────────────────
  const { stationData, dataSource, toggleConnection, acknowledgeAlert } = useStationData(activeStation);

  // ── Database persistence ──────────────────────────────────
  useDatabase(activeStation, stationData);

  // ── Derived state ────────────────────────────────────────
  // Backend alerts (or browser-demo alerts, computed in useStationData) — no extra client rules.
  const activeAlerts = stationData.activeAlerts || [];
  const criticalCount = activeAlerts.filter(a => a.level === 'critical').length;
  const isConnected = stationData.connected !== undefined ? stationData.connected : true;
  // Global data-source status: live simulator / physics fallback / browser demo / offline
  const telemetryBadge = !isConnected
    ? 'offline'
    : dataSource === 'simulation'
      ? 'browser-demo'
      : dataSource === 'websocket'
        ? (stationData.telemetrySource || 'connecting')
        : 'connecting';
  const aiHealth = stationData.aiHealth || 'healthy';
  const dependencyAlerts = stationData.dependencyAlerts || [];
  const eventTimeline = stationData.eventTimeline || [];
  const updatedAt = telemetryBadge === 'connecting' ? null : stationData.timestamp;
  const demoActive = Boolean(stationData.provenance?.activeScenario);

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

  const handleNavAction = useCallback((action) => {
    if (action === 'twinInspector') setShowTwinInspector(true);
  }, []);

  const handleStationChange = useCallback((newStation) => {
    trackStationSwitch(activeStation, newStation);
    setActiveStation(newStation);
  }, [activeStation]);

  const handleToggleConnection = useCallback(() => {
    toggleConnection();
    trackConnectionToggle(!isConnected);
  }, [toggleConnection, isConnected]);

  const handleAlertClick = useCallback((buildingId) => {
    setSelectedBuilding(buildingId);
  }, []);

  // ── Render module panel ───────────────────────────────────
  const panelName = `${MODULES[activeModule]?.title ?? 'Module'} panel`;

  function renderModulePanelInner() {
    switch (activeModule) {
      case 'environmental':
        return (
          <EnvironmentalPanel
            sensorData={stationData.sensors}
            activeStation={activeStation}
            provenance={stationData.provenance}
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
            activeStation={activeStation}
          />
        );
      case 'energy':
        return (
          <EnergyModule
            sensorData={stationData.sensors}
            energy={stationData.energy}
            replay={stationData.replay}
            provenance={stationData.provenance}
            activeAlerts={activeAlerts}
            activeStation={activeStation}
            telemetrySource={telemetryBadge}
            timestamp={stationData.timestamp}
            updatedAt={updatedAt}
          />
        );
      case 'logistics':
        return <LogisticsPanel activeStation={activeStation} sensorData={stationData.sensors} />;
      case 'simulation':
        return <WhatIfSimulationPanel activeStation={activeStation} sensorData={stationData.sensors} />;
      case 'reports':
        return <ReportPanel activeStation={activeStation} sensorData={stationData.sensors} />;
      case 'remote':
        return (
          <RemoteControlPanel
            activeStation={activeStation}
            sensorData={stationData.sensors}
            onAcknowledgeAlert={acknowledgeAlert}
          />
        );
      case 'admin':
        return <AdminPanel activeStation={activeStation} />;
      case 'ai':
        return <AiPanel activeStation={activeStation} />;
      default:
        return null;
    }
  }

  // One module page at a time. The wrapper is keyed by module, so switching unmounts
  // the previous panel outright (audit F1: with AnimatePresence around lazy panels the
  // exiting ones never unmounted and every visited module stayed on screen).
  // Each page has its own ErrorBoundary so one crash never blanks the app.
  function renderModulePage() {
    const migrated = MODULES[activeModule]?.migrated;
    const page = (
      <ErrorBoundary name={panelName} resetKey={activeStation}>
        <Suspense fallback={<PanelFallback name={panelName} />}>
          {renderModulePanelInner()}
        </Suspense>
      </ErrorBoundary>
    );
    return migrated ? (
      <div key={activeModule} className="module-content-scroll" data-testid="module-panel" data-module={activeModule}>
        <div className="module-page">{page}</div>
      </div>
    ) : (
      <LegacySurface key={activeModule} className="module-content-scroll legacy" data-testid="module-panel" data-module={activeModule}>
        {page}
      </LegacySurface>
    );
  }

  return (
    <div className="aurora-app">
      <TopBar
        activeStation={activeStation}
        onStationChange={handleStationChange}
        isDesktop={isDesktop}
        onOpenNav={() => setMobileNavOpen(true)}
        telemetryBadge={telemetryBadge}
        isConnected={isConnected}
        alertCount={activeAlerts.length}
        criticalCount={criticalCount}
        updatedAt={updatedAt}
        onOpenLink={openLink}
        onOpenAlerts={openAlerts}
        onToggleTimeline={() => setShowTimeline(prev => !prev)}
        onOpenDemo={toggleDemo}
        demoActive={demoActive}
      />

      <div className="app-layout-body">
        <SideNav
          isDesktop={isDesktop}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          activeModule={activeModule}
          onSelect={handleModuleChange}
          onAction={handleNavAction}
          collapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
          activeStation={activeStation}
          onStationChange={handleStationChange}
          replayMs={stationData.replay?.timeMs ?? null}
        />

        <main className="main-stage" id="main">
          {activeModule === 'overview' ? (
            <LegacySurface className="overview-stage" data-tour="overview">
              {/* 3D Twin Scene — unchanged until the Phase 2 rebuild */}
              <div className="scene-container">
                <ErrorBoundary name="3D station view">
                  <Suspense fallback={<PanelFallback name="3D station view" />}>
                    <StationScene
                      alertStates={stationData.alerts}
                      selectedBuilding={selectedBuilding}
                      onBuildingClick={handleBuildingClick}
                      onBuildingHover={handleBuildingHover}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>

              <ErrorBoundary name="Overview HUD">
                <Suspense fallback={null}>
                  <OverviewHUD
                    sensorData={stationData.sensors}
                    alerts={stationData.alerts}
                    activeAlerts={activeAlerts}
                    activeStation={activeStation}
                    isConnected={isConnected}
                    timestamp={stationData.timestamp}
                    telemetrySource={telemetryBadge}
                    provenance={stationData.provenance}
                    replay={stationData.replay}
                    onOpenTwinInspector={() => setShowTwinInspector(true)}
                  />
                </Suspense>
              </ErrorBoundary>
            </LegacySurface>
          ) : renderModulePage()}
        </main>
      </div>

      {/* ── Overlays (legacy styling until rollout 1B) ── */}
      <LegacySurface sx={{ display: 'contents' }}>
        <Suspense fallback={null}>
          {mounted.link && (
            <ConnectionPanel
              isOpen={showConnectionDrawer}
              onClose={() => setShowConnectionDrawer(false)}
              isConnected={isConnected}
              onToggleConnection={handleToggleConnection}
              offlineQueueSize={stationData.offlineQueueSize || 0}
              telemetryBadge={telemetryBadge}
              provenance={stationData.provenance}
            />
          )}

          {mounted.alerts && (
            <AlertFeed
              isOpen={showAlertsDrawer}
              onClose={() => setShowAlertsDrawer(false)}
              alerts={activeAlerts}
              onAlertClick={handleAlertClick}
              onAcknowledge={acknowledgeAlert}
              activeStation={activeStation}
              canAcknowledge={dataSource === 'websocket'}
            />
          )}

          {selectedBuilding && (
            <BuildingPanel
              buildingId={selectedBuilding}
              sensorData={stationData.sensors[selectedBuilding]}
              historyData={stationData.history?.[selectedBuilding]}
              alertLevel={stationData.alerts?.[selectedBuilding]}
              onClose={() => setSelectedBuilding(null)}
            />
          )}

          {showTimeline && (
            <EventTimeline events={eventTimeline} onClose={() => setShowTimeline(false)} />
          )}

          {/* Digital Twin Inspector Modal — mounted only once it is first opened. */}
          {showTwinInspector && (
            <TwinInspector
              activeStation={activeStation}
              isOpen={showTwinInspector}
              onClose={() => setShowTwinInspector(false)}
            />
          )}

          {mounted.demo && <DemoControl activeStation={activeStation} isOpen={showDemo} onClose={closeDemo} />}
        </Suspense>
      </LegacySurface>
    </div>
  );
}
