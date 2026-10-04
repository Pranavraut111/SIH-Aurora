/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — React wrapper around SceneEngine. Feeds it the props
   (station, alerts, selection, replay clock, wind, overlay band), and
   renders the DOM controls, the hover label and the descriptions.
   Throws during setup → onFatal → the 2D overview (StationScene.jsx).
   ═══════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildingList, dependencyEdges, sensorCatalog, stationMeta } from '../data/stationConfig';
import { apiGet } from '../services/api';
import { usePolling } from '../hooks/usePolling';
import { computeHeat, heatHex, HEAT_STOPS, heatRgb } from './heat';
import EquipmentTelemetryPanel from '../modules/twin/EquipmentTelemetryPanel';
import { sceneInfo } from '../data/stationConfigDetail';
import { solarPosition } from '../lib/solar';
import { useNow } from '../hooks/useNow';
import { STATUS_LABEL } from '../ui/statusLabels';
import { detectTier, levelOf, phaseOf } from './bindings';
import { transitionFor } from './flyover';
import { isTypingTarget } from '../shell/useShortcuts';
import { STATION_IDS, formatCoords } from '../data/stationConfig';
import { SceneEngine } from './engine';
import SceneControls from './SceneControls';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const LEVEL_HEX = { normal: '#5FD08A', warning: '#F5B83D', critical: '#FF6B6B' };
const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_STOPS.map((t) => `rgb(${heatRgb(t).join(', ')}) ${Math.round(t * 100)}%`).join(', ')})`;

function sameLabels(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((l, i) => l.id === b[i].id && Math.abs(l.x - b[i].x) < 1 && Math.abs(l.y - b[i].y) < 1 && l.level === b[i].level && Math.abs(l.heat - b[i].heat) < 0.005);
}

function usePrefersReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return undefined;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

function initialTier() {
  const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
  return detectTier({
    coarsePointer: coarse,
    minScreen: Math.min(window.screen?.width || 1080, window.screen?.height || 1080),
    deviceMemory: navigator.deviceMemory,
    cores: navigator.hardwareConcurrency,
  });
}

export default function StationScene3D({
  activeStation = 'maitri', alertStates = {}, selectedBuilding, onBuildingClick, onBuildingHover, onStationChange,
  sensors, replay, avoidBottom = 0, onFatal, sceneMode: sceneModeProp, onSceneModeChange,
}) {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const labelRef = useRef(null);
  const cbRef = useRef({});
  const reducedMotion = usePrefersReducedMotion();
  const [hovered, setHovered] = useState(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState('station');
  const [flyingTo, setFlyingTo] = useState(null);
  const [pinPos, setPinPos] = useState({});
  const [zoneLabels, setZoneLabels] = useState(null);
  const [localMode, setLocalMode] = useState('normal');
  const sceneMode = sceneModeProp ?? localMode;
  const modeCbRef = useRef(null);
  const setSceneMode = useCallback((m) => (modeCbRef.current ? modeCbRef.current(m) : setLocalMode(m)), []);
  useEffect(() => { modeCbRef.current = onSceneModeChange || null; });
  const modeRef = useRef(sceneMode);
  useEffect(() => { modeRef.current = sceneMode; });
  const [panelMin, setPanelMin] = useState(() => { try { return localStorage.getItem('aurora.internalsMinimized') === '1'; } catch { return false; } });
  const togglePanelMin = useCallback(() => setPanelMin((v) => {
    try { localStorage.setItem('aurora.internalsMinimized', v ? '0' : '1'); } catch { /* private mode */ }
    return !v;
  }), []);
  const stationRef = useRef(activeStation);
  useEffect(() => { stationRef.current = activeStation; });
  useEffect(() => { cbRef.current = { onBuildingClick, onBuildingHover, onFatal, onStationChange }; });
  const wallMs = useNow(60_000);   // for the description when there is no replay clock

  // Create the engine once; a failure here is the "3D renderer failed" path.
  useEffect(() => {
    const container = containerRef.current;
    let engine;
    try {
      const coords = {}; const prevailingWind = {};
      ['maitri', 'bharati'].forEach((sid) => {
        const m = stationMeta(sid);
        coords[sid] = [m.latitude, m.longitude];
        prevailingWind[sid] = sceneInfo(sid)?.prevailingWindFromDeg?.value ?? 90;
      });
      engine = new SceneEngine(container, {
        tier: initialTier(),
        reducedMotion: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
        coords,
        prevailingWind,
        callbacks: {
          onPick: (id) => cbRef.current.onBuildingClick?.(id),
          onHover: (id) => { setHovered(id); cbRef.current.onBuildingHover?.(id); },
          onHoverMove: (pt) => {
            const el = labelRef.current;
            if (!el) return;
            if (!pt) { el.style.visibility = 'hidden'; return; }
            el.style.visibility = 'visible';
            el.style.transform = `translate(${Math.round(pt[0])}px, ${Math.round(pt[1])}px) translate(-50%, calc(-100% - 10px))`;
          },
          onFatal: (err) => cbRef.current.onFatal?.(err),
          onView: (v) => setView(v),
          onFlight: ({ to, flying }) => setFlyingTo(flying ? to : null),
          onZoneLabels: (labels) => setZoneLabels((prev) => (sameLabels(prev, labels) ? prev : labels)),
          onPins: (pins) => setPinPos((prev) => {
            const same = Object.keys(pins).every((k) => prev[k] && pins[k] && Math.abs(prev[k][0] - pins[k][0]) < 0.5 && Math.abs(prev[k][1] - pins[k][1]) < 0.5);
            return same && Object.keys(prev).length === Object.keys(pins).length ? prev : pins;
          }),
          onStationPick: (id) => {
            if (id === stationRef.current) engineRef.current?.setView('station');
            else cbRef.current.onStationChange?.(id);
          },
        },
      });
      if (import.meta.env.DEV) container.auroraEngine = engine;   // dev screenshots only
      engineRef.current = engine;
    } catch (err) {
      console.error('[StationScene] 3D init failed — switching to 2D overview', err);
      engine?.dispose?.();
      engineRef.current = null;
      cbRef.current.onFatal?.(err);
      return undefined;
    }
    const ro = window.ResizeObserver ? new ResizeObserver(() => engine.fit()) : null;
    ro?.observe(container);
    setReady(true);
    return () => {
      ro?.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Station: the first one without a transition; later switches fly over the continent
  // (a 200 ms crossfade under reduced motion or on the low quality tier).
  const shownStation = useRef(null);
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !ready) return;
    try {
      e.setStation(activeStation, { transition: transitionFor({ reducedMotion: e.reducedMotion, tier: e.tierName, first: !shownStation.current }) });
      shownStation.current = activeStation;
    } catch (err) {
      console.error('[StationScene] building the station failed — switching to 2D overview', err);
      cbRef.current.onFatal?.(err);
    }
  }, [activeStation, ready]);

  useEffect(() => { engineRef.current?.setAlerts(alertStates); }, [alertStates, ready]);
  useEffect(() => { engineRef.current?.setSelected(selectedBuilding); }, [selectedBuilding, ready]);
  useEffect(() => { engineRef.current?.setAvoidBottom(avoidBottom); }, [avoidBottom, ready]);
  useEffect(() => { if (engineRef.current) engineRef.current.reducedMotion = reducedMotion; }, [reducedMotion]);

  // ── Inspection modes (X-ray / Systems / Heat map) and the model internals ──
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !ready) return;
    STATION_IDS.forEach((sid) => e.setOverlayEdges(sid, dependencyEdges(sid)));
  }, [ready]);
  // Inspection modes belong to the station view; the Antarctica view goes back to normal.
  useEffect(() => { if (view === 'antarctica' && sceneMode !== 'normal') setSceneMode('normal'); }, [view, sceneMode, setSceneMode]);
  useEffect(() => {
    engineRef.current?.setSceneMode(sceneMode);
    if (sceneMode === 'normal') setZoneLabels(null);
  }, [sceneMode, ready]);

  const [anomaly, setAnomaly] = useState(null);
  useEffect(() => { setAnomaly(null); }, [activeStation]);
  usePolling(async (isActive) => {
    const res = await apiGet(`/ai/anomaly?stationId=${activeStation}`, { timeoutMs: 5000, quiet: true });
    if (isActive()) setAnomaly(res && typeof res === 'object' ? res : null);
  }, 5000, { key: activeStation, enabled: sceneMode !== 'normal' });

  const heat = useMemo(() => computeHeat(sensors || {}, sensorCatalog(activeStation), anomaly), [sensors, activeStation, anomaly]);
  const buildingHeat = useMemo(() => Object.fromEntries(Object.entries(heat.buildings).map(([id, b]) => [id, b.heat])), [heat]);
  useEffect(() => { engineRef.current?.setHeat(buildingHeat); }, [buildingHeat, ready]);

  // Keyboard: A toggles the Antarctica view, [ and ] switch station, Esc cancels a flight.
  // Keys another shortcut already used (e.g. "g a") arrive with defaultPrevented.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.body.classList.contains('driver-active')) return;
      const eng = engineRef.current;
      if (!eng) return;
      if (e.key === 'Escape' && eng.flight) { eng.cancelFlight(); return; }
      // X: X-ray, H: heat map, Esc: back to the normal view (station view only).
      if ((e.key === 'x' || e.key === 'X' || e.key === 'h' || e.key === 'H') && eng.view === 'station') {
        if (document.querySelector('[role="dialog"]')) return;
        const want = e.key.toLowerCase() === 'x' ? 'xray' : 'heatmap';
        setSceneMode(modeRef.current === want ? 'normal' : want);
        return;
      }
      if (e.key === 'Escape' && modeRef.current !== 'normal' && !document.querySelector('[role="dialog"]')) { setSceneMode('normal'); return; }
      if (e.key === 'a' || e.key === 'A') {
        if (document.querySelector('[role="dialog"]')) return;
        eng.setView(eng.view === 'antarctica' ? 'station' : 'antarctica');
        return;
      }
      if (e.key === '[' || e.key === ']') {
        const i = STATION_IDS.indexOf(stationRef.current);
        const next = STATION_IDS[(i + (e.key === ']' ? 1 : -1) + STATION_IDS.length) % STATION_IDS.length];
        cbRef.current.onStationChange?.(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSceneMode]);

  const lab = sensors?.lab || {};
  const windKmh = num(lab.env_wind);
  const windFromDeg = num(replay?.windFromDeg);   // ERA5 10 m direction of the replay instant (REANALYSIS)
  const replayMs = num(replay?.timeMs);
  useEffect(() => { engineRef.current?.setEnvironment({ windKmh, windFromDeg, replayMs }); }, [windKmh, windFromDeg, replayMs, ready]);

  // ── Text for the controls and the screen-reader descriptions ──
  const meta = stationMeta(activeStation);
  const info = sceneInfo(activeStation);
  const zones = useMemo(() => buildingList(activeStation).map((b) => ({
    id: b.id, name: b.name, physical: info?.zones?.[b.id]?.physical || b.description, level: levelOf(alertStates, b.id),
  })), [activeStation, alertStates, info]);

  const summary = useMemo(() => {
    const crit = zones.filter((z) => z.level === 'critical');
    const warn = zones.filter((z) => z.level === 'warning');
    if (flyingTo) return `Flying to ${stationMeta(flyingTo).name}.`;
    if (view === 'antarctica') return `Antarctica view. ${meta.name} selected; ${STATION_IDS.filter((s) => s !== activeStation).map((s) => stationMeta(s).name).join(', ')} available.`;
    const parts = [`${meta.name} station, schematic layout.`];
    if (crit.length) parts.push(`${crit.length} critical: ${crit.map((z) => z.name).join(', ')}.`);
    if (warn.length) parts.push(`${warn.length} warning: ${warn.map((z) => z.name).join(', ')}.`);
    parts.push(`${zones.length - crit.length - warn.length} normal.`);
    return parts.join(' ');
  }, [zones, meta.name, flyingTo, view, activeStation]);

  // Environment changes every tick, so it is a description, not a live region.
  const hourMs = replayMs != null ? Math.floor(replayMs / 3_600_000) * 3_600_000 : null;
  const environment = useMemo(() => {
    const t = hourMs ?? wallMs;
    const sun = solarPosition(t, meta.latitude, meta.longitude);
    const phase = phaseOf(sun.elevation);
    const sunText = phase === 'day' ? `Day, sun ${sun.elevation.toFixed(0)}° above the horizon`
      : phase === 'twilight' ? `Twilight, sun ${Math.abs(sun.elevation).toFixed(0)}° below the horizon`
        : `Night, sun ${Math.abs(sun.elevation).toFixed(0)}° below the horizon`;
    const when = hourMs != null ? 'replay clock' : 'wall clock';
    const wind = windKmh == null ? 'Wind unknown.' : `Wind ${Math.round(windKmh)} km/h${windKmh >= 15 ? ', blowing snow' : ''}.`;
    return `${sunText} (${when}). ${wind}`;
  }, [hourMs, wallMs, meta.latitude, meta.longitude, windKmh]);

  const aboutLines = useMemo(() => [
    `Schematic layout: building massing follows published descriptions of ${meta.name}; dimensions and positions are approximate (station_config.json records the source of each zone).`,
    'Terrain is procedural, shaped to the site’s character, not surveyed elevation data.',
    'Sun and daylight: computed for the station’s coordinates at the replay time (MODEL-DERIVED).',
    windFromDeg != null
      ? 'Blowing snow follows the reported wind speed and the ERA5 wind direction of the replay instant (REANALYSIS).'
      : 'Blowing snow follows the reported wind speed; its direction is the station’s assumed prevailing wind.',
    'The light falling snow is decorative, not data.',
    'Colour on a building shows its alert level; the Buildings list gives the same in text.',
    'X-ray, Systems and Heat map are inspection views (keys X and H). Heat is the hotter of threshold proximity and the physics-model residual; it is a diagnostic signal, not a probability of failure.',
  ], [meta.name, windFromDeg]);

  const hoverZone = zones.find((z) => z.id === hovered);
  const inspecting = ready && sceneMode !== 'normal' && view === 'station' && !flyingTo;
  const avoidBottomShown = sceneMode === 'normal' ? avoidBottom : 0;

  return (
    <div ref={containerRef} className="station-scene-3d" data-testid="station-scene-3d"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {ready && (
        <SceneControls
          view={flyingTo ? 'station' : view}
          antarcticaEnabled
          onViewChange={(v) => engineRef.current?.setView(v)}
          pins={STATION_IDS.map((sid) => ({ id: sid, name: stationMeta(sid).name, coords: formatCoords(sid), pos: pinPos[sid], selected: sid === activeStation }))}
          onPinSelect={(sid) => (sid === activeStation ? engineRef.current?.setView('station') : onStationChange?.(sid))}
          flying={!!flyingTo}
          zones={zones}
          selectedBuilding={selectedBuilding}
          onSelectBuilding={(id) => onBuildingClick?.(id)}
          summary={summary}
          environment={environment}
          stationName={meta.name}
          aboutLines={aboutLines}
          sceneMode={sceneMode}
          onSceneModeChange={setSceneMode}
        />
      )}
      {inspecting && zoneLabels && (
        <div className="scene-zone-labels" data-testid="scene-zone-labels">
          {zoneLabels.map((l) => {
            const z = zones.find((zz) => zz.id === l.id);
            if (!z) return null;
            // The expanded panel covers the right 412 px below the top bar; chips there would peek through it.
            const w = containerRef.current?.clientWidth || 0;
            if (w && l.x > w - (panelMin ? 360 : 424) && l.y > 40 && (!panelMin || l.y < 130)) return null;
            const colour = sceneMode === 'heatmap' ? heatHex(l.heat) : LEVEL_HEX[l.level];
            return (
              <button key={l.id} type="button" className="scene-zone-chip" data-testid={`scene-zone-chip-${l.id}`}
                aria-label={`Focus ${z.name}`} onClick={() => engineRef.current?.focusZone(l.id)}
                style={{ transform: `translate(${l.x}px, ${l.y}px) translate(-50%, -100%)`, '--chip': colour }}>
                <span className="scene-zone-chip__dot" />
                <span className="scene-zone-chip__name">{z.name}</span>
                <span className="scene-zone-chip__value">
                  {sceneMode === 'heatmap' ? `${Math.round(l.heat * 100)}%` : STATUS_LABEL[l.level]}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {inspecting && sceneMode === 'heatmap' && (
        <div className="scene-heat-legend" data-testid="scene-heat-legend" style={{ bottom: 12 + avoidBottomShown }}>
          <div className="scene-heat-legend__title">Heat · threshold proximity / model residual</div>
          <div className="scene-heat-legend__bar" style={{ background: HEAT_GRADIENT }} />
          <div className="scene-heat-legend__ticks"><span>Nominal</span><span>Warning 60%</span><span>Critical / 6σ</span></div>
        </div>
      )}
      {inspecting && (
        <EquipmentTelemetryPanel
          activeStation={activeStation}
          alerts={alertStates}
          heat={heat}
          anomaly={anomaly}
          mode={sceneMode}
          onFocusBuilding={(id) => engineRef.current?.focusZone(id)}
          onOpenBuilding={(id) => onBuildingClick?.(id)}
          onClose={() => setSceneMode('normal')}
          minimized={panelMin}
          onToggleMinimized={togglePanelMin}
        />
      )}
      <div ref={labelRef} aria-hidden="true" className="scene-hover-label"
        style={{ position: 'absolute', left: 0, top: 0, visibility: hoverZone ? 'visible' : 'hidden', pointerEvents: 'none', zIndex: 1 }}>
        {hoverZone && (
          <span>
            <strong>{hoverZone.name}</strong> · {STATUS_LABEL[hoverZone.level]}
          </span>
        )}
      </div>
    </div>
  );
}
