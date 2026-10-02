/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — the Antarctica view: the Natural Earth 1:110m outline
   (public domain; the same pre-projected path as the station locator,
   shell/antarctica.js) gently extruded, snow-white with soft shading,
   over a dark ocean; a 60/70/80° S graticule; both stations pinned at
   their real coordinates (south-polar stereographic, 0° meridian toward −z).
   No relief data: the extrusion is a uniform slab (plan §12 cut list).
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { ANTARCTICA_PATH, parallelRadius, project } from '../shell/antarctica';
import { ACCENT_HEX, NEUTRAL_HEX } from './bindings';
import { srgb, standard, terrainMaterial } from './materials';
import { arcPoint } from './flyover';

export const SCALE = 10;          // outline units → scene units
const DEPTH = 7;
const TOP = DEPTH + 2.5;          // top of the bevelled slab

/** Parse the M/L/Z path into arrays of [x, y] points. */
export function parsePath(d) {
  const polys = [];
  let cur = null;
  const re = /([MLZ])\s*(-?[\d.]+)?\s*(-?[\d.]+)?/g;
  let m;
  while ((m = re.exec(d))) {
    if (m[1] === 'M') { cur = [[Number(m[2]), Number(m[3])]]; polys.push(cur); }
    else if (m[1] === 'L' && cur) cur.push([Number(m[2]), Number(m[3])]);
    else if (m[1] === 'Z') cur = null;
  }
  return polys.filter((p) => p.length >= 3);
}

/** Scene position of a latitude/longitude on the slab's top. */
export function stationPoint(lat, lon) {
  const [x, y] = project(lat, lon);
  return new THREE.Vector3(x * SCALE, TOP, y * SCALE);
}

export function buildContinent({ coords }) {
  const scene = new THREE.Scene();
  scene.background = srgb('#0B1118');

  const shapes = parsePath(ANTARCTICA_PATH).map((poly) => new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x * SCALE, y * SCALE))));
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: DEPTH, bevelEnabled: true, bevelThickness: 2.5, bevelSize: 2.5, bevelSegments: 3, curveSegments: 4 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, DEPTH, 0);
  geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  geo.setAttribute('aSnow', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  geo.setAttribute('aLake', new THREE.BufferAttribute(new Float32Array(n), 1));
  const ice = terrainMaterial({ snow: '#E9EEF4', scale: 0.08 });
  ice.userData.uniforms.uSun.value = 0.15;
  const slab = new THREE.Mesh(geo, ice);
  scene.add(slab);

  const ocean = new THREE.Mesh(new THREE.CircleGeometry(2600, 96), standard('#122130', { roughness: 0.55, metalness: 0.1 }));
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);

  scene.add(new THREE.HemisphereLight(srgb('#C9D7E8'), srgb('#1A2430'), 0.75));
  const sun = new THREE.DirectionalLight(srgb('#FFF6EA'), 1.4);
  sun.position.set(-900, 1100, 700);
  scene.add(sun);

  // Graticule: parallels 60/70/80° S and meridians every 30°, hairline over everything.
  const gMat = new THREE.LineBasicMaterial({ color: srgb('#8C95A1'), transparent: true, opacity: 0.32, depthWrite: false });
  [-60, -70, -80].forEach((lat) => {
    const r = parallelRadius(lat) * SCALE;
    const pts = [];
    for (let i = 0; i <= 160; i += 1) { const a = (i / 160) * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * r, TOP + 0.6, -Math.cos(a) * r)); }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gMat));
  });
  for (let lon = 0; lon < 360; lon += 30) {
    const a = (lon * Math.PI) / 180;
    const r0 = parallelRadius(-86) * SCALE; const r1 = parallelRadius(-60) * SCALE;
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(Math.sin(a) * r0, TOP + 0.6, -Math.cos(a) * r0), new THREE.Vector3(Math.sin(a) * r1, TOP + 0.6, -Math.cos(a) * r1),
    ]), gMat));
  }

  // Pins: a stem and a head per station; the selected one in the accent colour.
  const pins = {};
  const accent = srgb(ACCENT_HEX); const neutral = srgb(NEUTRAL_HEX);
  Object.entries(coords).forEach(([id, [lat, lon]]) => {
    const base = stationPoint(lat, lon);
    const g = new THREE.Group();
    g.position.copy(base);
    const mat = new THREE.MeshBasicMaterial({ color: neutral, toneMapped: false });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 34, 10), mat);
    stem.position.y = 17;
    const head = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 12), mat);
    head.position.y = 36;
    const foot = new THREE.Mesh(new THREE.RingGeometry(6, 8, 40), new THREE.MeshBasicMaterial({ color: neutral, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    foot.rotation.x = -Math.PI / 2; foot.position.y = 0.4;
    [stem, head, foot].forEach((o) => { o.userData.stationId = id; g.add(o); });
    // generous invisible hit target
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 50, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 25; hit.userData.stationId = id;
    g.add(hit);
    scene.add(g);
    pins[id] = { group: g, mat, foot, hit, base, head: base.clone().add(new THREE.Vector3(0, 44, 0)) };
  });

  // The fly-over route: a dashed arc between the two stations.
  const arcMat = new THREE.LineDashedMaterial({ color: accent, dashSize: 10, gapSize: 7, transparent: true, opacity: 0.85, toneMapped: false });
  const arc = new THREE.Line(new THREE.BufferGeometry(), arcMat);
  scene.add(arc);

  function setSelected(id) {
    Object.entries(pins).forEach(([pid, p]) => {
      const c = pid === id ? accent : neutral;
      p.mat.color.copy(c); p.foot.material.color.copy(c);
      p.group.scale.setScalar(pid === id ? 1.15 : 1);
    });
    const ids = Object.keys(pins);
    const other = ids.find((x) => x !== id);
    if (!other) return;
    const a = pins[id].base.toArray(); const b = pins[other].base.toArray();
    const pts = [];
    for (let i = 0; i <= 64; i += 1) pts.push(new THREE.Vector3(...arcPoint(a, b, i / 64, 110)));
    arc.geometry.dispose();
    arc.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    arc.computeLineDistances();
  }

  const fitBox = new THREE.Box3().setFromObject(slab);
  return {
    scene, pins, setSelected,
    hitTargets: Object.values(pins).map((p) => p.hit),
    fitPoints: [fitBox.min, fitBox.max, new THREE.Vector3(fitBox.min.x, TOP, fitBox.max.z), new THREE.Vector3(fitBox.max.x, TOP, fitBox.min.z)],
    overview: { position: new THREE.Vector3(0, 1300, 1000), target: new THREE.Vector3(0, 0, -60) },
    /** Camera pose low over a station, looking at it (start/end of the glide). */
    poseOver(id) {
      const p = pins[id].base;
      return { position: p.clone().add(new THREE.Vector3(0, 420, 400)), target: p.clone() };
    },
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    },
  };
}
