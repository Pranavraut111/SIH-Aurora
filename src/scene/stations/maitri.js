/* ═══════════════════════════════════════════════════════════════
   Maitri — Schirmacher Oasis, Dronning Maud Land.
   SCHEMATIC layout (docs/phase2-3d-plan.md §2.2). Drawn from published
   descriptions: one long, U-shaped, tan main building on steel stilts /
   adjustable telescopic legs with the national flag over the entrance; a
   fuel farm, a lake-water pump house, containerised modules. The site is an
   ice-free rocky plateau with frozen lakes (Lake Priyadarshini supplies the
   water); the continental ice sheet rises to the south.
   ASSUMED: every dimension and position, including the lake's.
   Axes: metres, +x east, −z north, y up (station pad = 0).
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { makeNoise, padWeight, smoothstep } from '../noise';
import { corrugatedTexture, flagTexture, srgb, standard, tanPanelTexture } from '../materials';
import { Batcher, commonMaterials, container, latticeMast, makeZone, pipeline, tankFarm } from '../builders';

const LEGS = 1.8;
const H = 4.4;
const noise = makeNoise(11);

// Frozen lakes: [x, z, rx, rz, level]. The large one stands in for Lake Priyadarshini (position assumed).
const LAKES = [
  [-150, 40, 78, 44, 0.5],
  [190, -120, 52, 30, 1.5],
  [70, 260, 46, 30, 3],
  [-60, -260, 60, 28, 0],
];
const lakeWeight = (x, z) => LAKES.reduce((m, [lx, lz, rx, rz]) => Math.max(m, 1 - Math.hypot((x - lx) / rx, (z - lz) / rz)), 0);

const PADS = [
  { x: 0, z: 2, hx: 37, hz: 24, feather: 22, y: 0 },
  { x: -66, z: -34, hx: 15, hz: 11, feather: 14, y: -0.5 },
  { x: 50, z: 28, hx: 14, hz: 10, feather: 12, y: 0 },
  { x: 47, z: -30, hx: 10, hz: 8, feather: 16, y: 0 },
  { x: -74, z: 40, hx: 5, hz: 5, feather: 8, y: 1 },
  { x: 30, z: -50, hx: 4, hz: 4, feather: 8, y: 0.5 },
];

function rawHeight(x, z) {
  const hills = noise.ridged(x * 0.009, z * 0.009, 5) * 26 + noise.fbm(x * 0.04, z * 0.04, 4) * 5 - 8;
  const ice = smoothstep(380, 1400, z);
  const sheet = Math.max(0, z - 380) * 0.16 + noise.fbm(x * 0.002, z * 0.002, 3) * 20 * ice;
  const shelf = smoothstep(-800, -1500, z);
  let h = hills * (1 - ice) * (1 - shelf) + sheet + shelf * -20;
  const l = lakeWeight(x, z);
  if (l > 0) {
    const level = LAKES.find(([lx, lz, rx, rz]) => 1 - Math.hypot((x - lx) / rx, (z - lz) / rz) === l)[4];
    h += (level - h) * smoothstep(0, 0.45, l);
  }
  return h;
}

function height(x, z) {
  let h = rawHeight(x, z);
  for (const p of PADS) {
    const w = padWeight(x, z, p);
    if (w > 0) h += (p.y - h) * w;
  }
  return h;
}

export const maitri = {
  id: 'maitri',
  label: 'Maitri',
  terrain: {
    inner: 900,
    outer: 7000,
    height,
    palette: { rockA: '#5E5C5A', rockB: '#2F2E2D', snow: '#EDF1F6', lake: '#8DA8C4' },
    snow(x, z, y, ny) {
      const drift = noise.fbm(x * 0.018 + 4, z * 0.018, 3);
      const sheet = smoothstep(300, 520, z) + smoothstep(-700, -1000, z);
      return Math.min(1, Math.max(0, 0.3 + (drift - 0.5) * 2.4 + (ny - 0.97) * 6 + sheet * 1.6));
    },
    lake: (x, z) => smoothstep(0.08, 0.2, lakeWeight(x, z)),
  },
  sea: null,
  camera: { position: [74, 40, -104], target: [-6, 4, 4] },
  orbit: { minDistance: 40, maxDistance: 420 },
  build,
};

/** A box whose UVs are in metres / tile size, so a repeating texture keeps its scale. */
function texturedBox(b, mat, w, h, d, x, y, z, tile = [4, 2.2]) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f += 1) {
    for (let k = 0; k < 4; k += 1) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * faces[f][0]) / tile[0], (uv.getY(i) * faces[f][1]) / tile[1]);
    }
  }
  b.add(g, mat, new THREE.Matrix4().setPosition(x, y, z));
}

function wing(b, m, mats, { x, z, w, d }) {
  const yb = LEGS;
  texturedBox(b, mats.wall, w, H, d, x, yb + H / 2, z);
  b.box(mats.roof, w + 0.7, 0.45, d + 0.7, x, yb + H + 0.22, z);
  b.box(mats.trim, w + 0.1, 0.35, d + 0.1, x, yb + 0.17, z);
  // telescopic legs every 6 m along both long sides, braced
  const along = w >= d;
  const len = along ? w : d;
  for (let t = -len / 2 + 1.5; t <= len / 2 - 1.5 + 0.01; t += 6) {
    [-1, 1].forEach((s) => {
      const lx = along ? x + t : x + s * (w / 2 - 1);
      const lz = along ? z + s * (d / 2 - 1) : z + t;
      b.cylinder(m.darkSteel, 0.16, 0.2, LEGS, lx, LEGS / 2, lz, 8);
      b.cylinder(m.steel, 0.24, 0.24, 0.5, lx, 0.5, lz, 8);
      b.box(m.concrete, 0.8, 0.3, 0.8, lx, 0.1, lz);
    });
  }
  // windows on both long faces
  const step = 4.5;
  for (let t = -len / 2 + 3; t <= len / 2 - 3; t += step) {
    [-1, 1].forEach((s) => {
      if (along) b.box(mats.glass, 1.25, 0.95, 0.12, x + t, yb + 2.5, z + s * (d / 2 + 0.03));
      else b.box(mats.glass, 0.12, 0.95, 1.25, x + s * (w / 2 + 0.03), yb + 2.5, z + t);
    });
  }
}

function build(group) {
  const m = commonMaterials();
  const b = new Batcher();
  const wallTex = tanPanelTexture();
  const mats = {
    wall: standard('#FFFFFF', { map: wallTex, roughness: 0.72, metalness: 0.05 }),
    roof: standard('#5D6168', { roughness: 0.6, metalness: 0.35 }),
    trim: standard('#6E5B40', { roughness: 0.7 }),
    glass: standard('#2A3440', { roughness: 0.15, metalness: 0.6 }),
  };

  // ── U-shaped main building ────────────────────────────────
  wing(b, m, mats, { x: 0, z: -12, w: 60, d: 11 });            // spine (living, galley, mess)
  wing(b, m, mats, { x: -24.5, z: 7.5, w: 11, d: 28 });         // west arm
  wing(b, m, mats, { x: 24.5, z: 7.5, w: 11, d: 28 });          // east arm
  // roof vents and boiler flues
  [[-24.5, 12], [24.5, 12], [-8, -12], [10, -12]].forEach(([x, z]) => {
    b.box(m.galvanised, 1.6, 1.2, 1.6, x, LEGS + H + 1.05, z);
    b.cylinder(m.darkSteel, 0.22, 0.22, 2.8, x + 1.2, LEGS + H + 1.8, z, 8);
  });
  // entrance porch and stair on the north face of the spine
  b.box(mats.wall, 5, H, 3, 0, LEGS + H / 2, -19);
  b.box(mats.roof, 5.6, 0.4, 3.6, 0, LEGS + H + 0.2, -19);
  for (let i = 0; i < 6; i += 1) b.box(m.steel, 2.4, 0.08, 0.6, 0, 0.3 + i * 0.3, -21 - i * 0.6);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.8), standard('#FFFFFF', { map: flagTexture(), roughness: 0.8, side: THREE.DoubleSide }));
  flag.position.set(-6.5, LEGS + 2.8, -17.6);
  flag.rotation.y = Math.PI;
  group.add(flag);

  // ── Fuel farm (north-west), in a bund ─────────────────────
  tankFarm(b, m, -66, -0.5, -34, { cols: 3, rows: 2, r: 3.1, h: 6.2 });

  // ── Generator / power module (east) ──────────────────────
  const genWall = standard('#FFFFFF', { map: corrugatedTexture('#5E6A5C'), roughness: 0.6, metalness: 0.3 });
  texturedBox(b, genWall, 13, 4.6, 8, 47, 2.3, -30, [2, 1]);
  b.box(mats.roof, 13.6, 0.35, 8.6, 47, 4.75, -30);
  [42, 45, 48].forEach((x) => b.cylinder(m.darkSteel, 0.28, 0.28, 3.4, x, 6.3, -32.5, 10));
  b.box(m.galvanised, 3, 2.2, 3.4, 55.5, 1.1, -30);

  // ── Containerised modules: labs (3) and summer camp ──────
  const lab = standard('#FFFFFF', { map: corrugatedTexture('#D7DBDF'), roughness: 0.55, metalness: 0.25 });
  const camp = [corrugatedTexture('#A1402F'), corrugatedTexture('#2F5D7C'), corrugatedTexture('#5D7348'), corrugatedTexture('#B5762C')]
    .map((t) => standard('#FFFFFF', { map: t, roughness: 0.55, metalness: 0.25 }));
  [[42, 23], [42, 26.6], [42, 30.2]].forEach(([x, z]) => container(b, lab, m.darkSteel, x, 0, z));
  [[52, 22], [52, 25.6], [58.5, 22], [58.5, 25.6], [52, 32], [58.5, 32]].forEach(([x, z], i) => container(b, camp[i % camp.length], m.darkSteel, x, 0, z));

  // ── Lake-water pump house and pipeline ───────────────────
  b.box(m.concrete, 4.4, 3, 4, -74, 1 + 1.5, 40);
  b.box(mats.roof, 4.9, 0.3, 4.5, -74, 1 + 3.15, 40);
  pipeline(b, m, [[-72, 38], [-50, 24], [-30, 16]], height, 0.7);

  // ── Comms mast ────────────────────────────────────────────
  latticeMast(b, m, 30, 0.5, -50, 22, -2.6);

  b.build(group);

  // The main building is occupied all year: its windows are lit after dark.
  const night = [{ mat: mats.glass, color: srgb('#FFD39A'), intensity: 1.6 }];
  const zones = [
    makeZone('livingQuarters', { box: { x: 0, y: LEGS, z: -12, w: 60.8, h: H + 0.8, d: 11.8 }, ring: { x: 0, z: -12, y: 0, r: 31 } }),
    makeZone('heating', { box: { x: -24.5, y: LEGS, z: 9.3, w: 11.8, h: H + 0.8, d: 24.4 }, ring: { x: -24.5, z: 9, y: 0, r: 15 } }),
    makeZone('heatingB', { box: { x: 24.5, y: LEGS, z: 9.3, w: 11.8, h: H + 0.8, d: 24.4 }, ring: { x: 24.5, z: 9, y: 0, r: 15 } }),
    makeZone('generator', { box: { x: 48, y: 0, z: -30, w: 16, h: 8.2, d: 9.4 }, ring: { x: 48, z: -30, y: 0, r: 10 } }),
    makeZone('lab', { box: { x: 42, y: 0, z: 26.6, w: 6.8, h: 2.9, d: 10.2 }, ring: { x: 42, z: 26.6, y: 0, r: 7 } }),
    makeZone('storage', { box: { x: -66, y: -0.5, z: -34, w: 26, h: 7.2, d: 19 }, ring: { x: -66, z: -34, y: -0.5, r: 16 } }),
    makeZone('waterTank', { box: { x: -74, y: 1, z: 40, w: 5.6, h: 3.8, d: 5.2 }, ring: { x: -74, z: 40, y: 1, r: 6 } }),
    makeZone('commsMast', { box: { x: 30, y: 0.5, z: -50, w: 4, h: 23, d: 4 }, ring: { x: 30, z: -50, y: 0.5, r: 5 } }),
  ];
  return { zones, night };
}
