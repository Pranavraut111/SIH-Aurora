/* ═══════════════════════════════════════════════════════════════
   Aurora — station configuration (single source of truth)
   Imports simulator/station_config.json at build time — the same file the
   backend serves at GET /api/config/stations. Station metadata, buildings,
   the dependency graph and default alert thresholds all come from here,
   so the browser demo mode works without the backend.
   ═══════════════════════════════════════════════════════════════ */
import CONFIG from '../../simulator/station_config.json';

export const STATION_CONFIG = CONFIG;
export const STATION_IDS = Object.keys(CONFIG.stations);

/** Plain {key: value} metadata (drops source/confidence notes). */
export function stationMeta(stationId) {
  const meta = CONFIG.stations[stationId]?.metadata || {};
  return Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in v ? v.value : v]),
  );
}

/** Metadata with provenance notes ({value, source, confidence, needsNcporConfirmation}). */
export function stationMetaDetailed(stationId) {
  return CONFIG.stations[stationId]?.metadata || {};
}

/** "70.77°S, 11.73°E" */
export function formatCoords(stationId) {
  const { latitude, longitude } = stationMeta(stationId);
  if (latitude == null || longitude == null) return '—';
  const lat = `${Math.abs(latitude).toFixed(2)}°${latitude < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(longitude).toFixed(2)}°${longitude < 0 ? 'W' : 'E'}`;
  return `${lat}, ${lon}`;
}

/** "≈ 25 winter crew": the figure is approximate (medium/low confidence in station_config). */
export function crewLabel(stationId) {
  const n = stationMeta(stationId).personnelWinter;
  return typeof n === 'number' ? `≈ ${n} winter crew` : null;
}

/** The 3D overview's layout notes: {layout, prevailingWindFromDeg, zones: {id: {physical, source, confidence}}}. */
export function sceneInfo(stationId) {
  return CONFIG.stations[stationId]?.scene || null;
}

export function buildingList(stationId) {
  return CONFIG.stations[stationId]?.buildings || [];
}

export function dependencyEdges(stationId) {
  return CONFIG.stations[stationId]?.dependencyGraph?.edges || [];
}

/** {building: {depends: [...], feeds: [...]}} built from the edge list. */
export function dependencyGraph(stationId) {
  const graph = Object.fromEntries(buildingList(stationId).map((b) => [b.id, { depends: [], feeds: [] }]));
  dependencyEdges(stationId).forEach(({ source, target }) => {
    graph[source]?.feeds.push(target);
    graph[target]?.depends.push(source);
  });
  return graph;
}

/** {sensorId: {building, name, unit, thresholdRange, low?, high?, basis}} */
export function sensorCatalog(stationId) {
  return CONFIG.stations[stationId]?.sensors || {};
}
