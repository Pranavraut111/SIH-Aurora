/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — React wrapper around SceneEngine. Feeds it the props
   (station, alerts, selection, replay clock, wind, overlay band), and
   renders the DOM controls, the hover label and the descriptions.
   Throws during setup → onFatal → the 2D overview (StationScene.jsx).
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildingList, sceneInfo, stationMeta } from '../data/stationConfig';
import { solarPosition } from '../lib/solar';
import { useNow } from '../hooks/useNow';
import { STATUS_LABEL } from '../ui/statusLabels';
import { detectTier, levelOf, phaseOf } from './bindings';
import { SceneEngine } from './engine';
import SceneControls from './SceneControls';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
  activeStation = 'maitri', alertStates = {}, selectedBuilding, onBuildingClick, onBuildingHover,
  sensors, replay, avoidBottom = 0, onFatal,
}) {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const labelRef = useRef(null);
  const cbRef = useRef({});
  const reducedMotion = usePrefersReducedMotion();
  const [hovered, setHovered] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { cbRef.current = { onBuildingClick, onBuildingHover, onFatal }; });
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
        },
      });
      engine.container.dataset.quality = engine.tierName;
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

  // Station: first one without a transition, later switches with a crossfade.
  const shownStation = useRef(null);
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !ready) return;
    try {
      e.setStation(activeStation, { transition: shownStation.current ? 'crossfade' : 'none' });
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

  const lab = sensors?.lab || {};
  const windKmh = num(lab.env_wind);
  const windFromDeg = num(lab.env_wind_dir);
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
    const parts = [`${meta.name} station, schematic layout.`];
    if (crit.length) parts.push(`${crit.length} critical: ${crit.map((z) => z.name).join(', ')}.`);
    if (warn.length) parts.push(`${warn.length} warning: ${warn.map((z) => z.name).join(', ')}.`);
    parts.push(`${zones.length - crit.length - warn.length} normal.`);
    return parts.join(' ');
  }, [zones, meta.name]);

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
      ? 'Blowing snow follows the reported wind speed and direction.'
      : 'Blowing snow follows the reported wind speed; its direction is the station’s assumed prevailing wind.',
    'The light falling snow is decorative, not data.',
    'Colour on a building shows its alert level; the Buildings list gives the same in text.',
  ], [meta.name, windFromDeg]);

  const hoverZone = zones.find((z) => z.id === hovered);

  return (
    <div ref={containerRef} className="station-scene-3d" data-testid="station-scene-3d" data-view="station"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {ready && (
        <SceneControls
          view="station"
          antarcticaEnabled={false}
          onViewChange={() => {}}
          zones={zones}
          selectedBuilding={selectedBuilding}
          onSelectBuilding={(id) => onBuildingClick?.(id)}
          summary={summary}
          environment={environment}
          stationName={meta.name}
          aboutLines={aboutLines}
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
