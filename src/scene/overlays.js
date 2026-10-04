/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — "see inside" overlays for a station world.
     normal   the photoreal scene, unchanged
     xray     buildings turn to ghosted glass with blueprint edges; each
              subsystem's internal volume is shown as a core in its alert
              colour; dependency flows run between them
     systems  the normal scene plus the dependency graph as animated flows
     heatmap  each subsystem volume and a ground glow coloured by its heat
              (threshold proximity ⊕ physics-model residual, src/scene/heat.js)
   Built lazily the first time a mode needs it; nothing exists in 'normal'.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { heatRgb } from './heat';
import { buildInternals } from './internals';

export const SCENE_MODES = ['normal', 'xray', 'systems', 'heatmap'];

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BOX_EDGES = new THREE.EdgesGeometry(BOX);
const XRAY_EDGE = new THREE.Color('#7FDBFF').convertSRGBToLinear();
const FLOW_IDLE = new THREE.Color('#7FB2E5').convertSRGBToLinear();
const RELATION_COLORS = {
  powers: new THREE.Color('#7FDBFF').convertSRGBToLinear(),   // Electrical microgrid
  fuels: new THREE.Color('#F5B83D').convertSRGBToLinear(),    // Polar diesel line
  heats: new THREE.Color('#FF8C42').convertSRGBToLinear(),    // Thermal heating loop
  supplies: new THREE.Color('#5FD08A').convertSRGBToLinear(), // Water & utility loop
};
const PACKETS = 3;

let glowTexture = null;
function radialTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

const rgbColor = (rgb) => new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255).convertSRGBToLinear();

export function createOverlay(world) {
  const group = new THREE.Group();
  group.name = 'aurora-overlay';
  world.scene.add(group);
  const zoneById = Object.fromEntries(world.zones.map((z) => [z.id, z]));
  let mode = 'normal';
  let ghost = null;      // {saved: Map(material → props), edges: Group}
  let cores = null;      // {id: {mesh, edges}}
  let glows = null;      // {id: mesh}
  let flows = null;      // [{curve, tube, packets, source, target}]
  let grid = null;
  let internals = null;
  let edgesKey = '';
  const levels = {};
  const heat = {};

  function ensureInternals() {
    if (internals) return internals;
    internals = buildInternals(world);
    return internals;
  }

  // ── X-ray: ghost the site geometry and draw its edges ──────
  function ensureGhost() {
    if (ghost) return ghost;
    const saved = new Map();
    const edges = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: XRAY_EDGE, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
    world.site.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (!saved.has(m)) saved.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }); });
      const seg = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 28), lineMat);
      seg.matrixAutoUpdate = false;
      o.updateMatrixWorld();
      seg.matrix.copy(o.matrixWorld);
      seg.renderOrder = 4;
      edges.add(seg);
    });
    edges.visible = false;
    group.add(edges);
    ghost = { saved, edges, casters: [] };
    return ghost;
  }

  function setGhosted(on) {
    if (!on && !ghost) return;
    const g = ensureGhost();
    g.saved.forEach((orig, m) => {
      m.transparent = on ? true : orig.transparent;
      m.opacity = on ? 0.1 : orig.opacity;
      m.depthWrite = on ? false : orig.depthWrite;
      m.needsUpdate = true;
    });
    world.site.traverse((o) => {
      if (!o.isMesh) return;
      if (on) { o.userData.castShadowWas = o.castShadow; o.castShadow = false; } else if (o.userData.castShadowWas !== undefined) o.castShadow = o.userData.castShadowWas;
    });
    g.edges.visible = on;
  }

  function ensureGrid() {
    if (grid) return grid;
    grid = new THREE.GridHelper(360, 72, 0x7fdbff, 0x7fdbff);
    grid.material.transparent = true;
    grid.material.opacity = 0.12;
    grid.material.depthWrite = false;
    grid.material.toneMapped = false;
    grid.position.set(world.target.x, 0.3, world.target.z);
    grid.visible = false;
    group.add(grid);
    return grid;
  }

  // ── Subsystem cores (one translucent volume per zone) ──────
  function ensureCores() {
    if (cores) return cores;
    cores = {};
    world.zones.forEach((z) => {
      const mesh = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }));
      mesh.position.copy(z.shell.position); mesh.scale.copy(z.shell.scale); mesh.rotation.copy(z.shell.rotation);
      mesh.renderOrder = 5;
      const edges = new THREE.LineSegments(BOX_EDGES, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
      edges.position.copy(mesh.position); edges.scale.copy(mesh.scale); edges.rotation.copy(mesh.rotation);
      edges.renderOrder = 6;
      mesh.visible = false; edges.visible = false;
      group.add(mesh); group.add(edges);
      cores[z.id] = { mesh, edges };
    });
    return cores;
  }

  function ensureGlows() {
    if (glows) return glows;
    glows = {};
    world.zones.forEach((z) => {
      const r = (z.ring.geometry.parameters.innerRadius || 8) * 1.7;
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({
        map: radialTexture(), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(z.ring.position.x, z.ring.position.y + 0.25, z.ring.position.z);
      mesh.renderOrder = 3;
      mesh.visible = false;
      group.add(mesh);
      glows[z.id] = mesh;
    });
    return glows;
  }

  // ── Dependency flows ───────────────────────────────────────
  function buildFlows(edges) {
    const key = edges.map((e) => `${e.source}>${e.target}`).join('|');
    if (flows && key === edgesKey) return flows;
    flows?.forEach((f) => { group.remove(f.tube); f.tube.geometry.dispose(); f.tube.material.dispose(); f.packets.forEach((p) => { group.remove(p); p.material.dispose(); }); });
    edgesKey = key;
    const packetGeo = new THREE.SphereGeometry(0.7, 10, 8);
    flows = edges.map(({ source, target, relation }) => {
      const a = zoneById[source]; const b = zoneById[target];
      if (!a || !b) return null;
      const p0 = a.center.clone().add(new THREE.Vector3(0, 1.5, 0));
      const p2 = b.center.clone().add(new THREE.Vector3(0, 1.5, 0));
      const mid = p0.clone().lerp(p2, 0.5);
      mid.y = Math.max(p0.y, p2.y) + 6 + p0.distanceTo(p2) * 0.22;
      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.28, 6, false),
        new THREE.MeshBasicMaterial({ color: FLOW_IDLE, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
      tube.renderOrder = 7;
      tube.visible = false;
      group.add(tube);
      const packets = Array.from({ length: PACKETS }, () => {
        const m = new THREE.Mesh(packetGeo, new THREE.MeshBasicMaterial({ color: FLOW_IDLE, toneMapped: false }));
        m.renderOrder = 8; m.visible = false;
        group.add(m);
        return m;
      });
      return { curve, tube, packets, source, target, relation: relation || 'powers' };
    }).filter(Boolean);
    return flows;
  }

  // ── Styling ────────────────────────────────────────────────
  function restyle(colours) {
    const xray = mode === 'xray'; const heatmap = mode === 'heatmap'; const showFlows = xray || mode === 'systems';
    if (xray || heatmap) ensureCores();
    if (cores) {
      Object.entries(cores).forEach(([id, c]) => {
        const on = xray || heatmap;
        c.mesh.visible = on; c.edges.visible = on;
        if (!on) return;
        const col = heatmap ? rgbColor(heatRgb(heat[id] ?? 0)) : (levels[id] === 'normal' || !levels[id] ? colours.normal : colours[levels[id]]);
        c.mesh.material.color.copy(col);
        c.edges.material.color.copy(col);
        c.mesh.material.opacity = heatmap ? 0.28 + 0.32 * (heat[id] ?? 0) : (levels[id] && levels[id] !== 'normal' ? 0.42 : 0.22);
      });
    }
    if (heatmap) ensureGlows();
    if (glows) {
      Object.entries(glows).forEach(([id, g]) => {
        g.visible = heatmap;
        if (heatmap) { g.material.color.copy(rgbColor(heatRgb(heat[id] ?? 0))); g.material.opacity = 0.45 + 0.5 * (heat[id] ?? 0); }
      });
    }
    if (xray || mode === 'systems') {
      ensureInternals().setVisible(true);
    } else if (internals) {
      internals.setVisible(false);
    }

    flows?.forEach((f) => {
      f.tube.visible = showFlows;
      const lvl = levels[f.source];
      const baseCol = RELATION_COLORS[f.relation] || FLOW_IDLE;
      const col = lvl === 'critical' || lvl === 'warning' ? colours[lvl] : baseCol;
      f.tube.material.color.copy(col);
      f.packets.forEach((p) => { p.visible = showFlows; p.material.color.copy(col); });
    });
  }

  return {
    group,
    get mode() { return mode; },
    /** Zones whose shells the engine should hide (cores replace them). */
    hidesShells() { return mode === 'xray' || mode === 'heatmap'; },
    animating() { return mode === 'xray' || mode === 'systems'; },
    setMode(next, { edges = [], colours }) {
      if (!next || next === mode) { restyle(colours); return; }
      mode = next;
      setGhosted(mode === 'xray');
      if (mode === 'xray') ensureGrid();
      if (grid) grid.visible = mode === 'xray';
      if (mode === 'xray' || mode === 'systems') buildFlows(edges);
      restyle(colours);
    },
    setEdges(edges, colours) { if (mode === 'xray' || mode === 'systems') { buildFlows(edges); restyle(colours); } },
    setLevels(map, colours) { Object.assign(levels, map); restyle(colours); },
    setHeat(map, colours) { Object.keys(heat).forEach((k) => delete heat[k]); Object.assign(heat, map); restyle(colours); },
    update(time) {
      if (!flows || !(mode === 'xray' || mode === 'systems')) return;
      flows.forEach((f, i) => {
        f.packets.forEach((p, k) => {
          const u = (time * 0.22 + k / PACKETS + i * 0.13) % 1;
          p.position.copy(f.curve.getPoint(u));
        });
      });
    },
    dispose() {
      setGhosted(false);
      internals?.dispose();
      group.traverse((o) => {
        if (o.geometry && o.geometry !== BOX && o.geometry !== BOX_EDGES) o.geometry.dispose();
        o.material?.dispose?.();
      });
      world.scene.remove(group);
    },
  };
}
