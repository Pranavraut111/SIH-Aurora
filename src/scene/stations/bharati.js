/* ═══════════════════════════════════════════════════════════════
   Bharati — Grovnes promontory, Larsemann Hills, Prydz Bay coast.
   SCHEMATIC layout (docs/phase2-3d-plan.md §2.1). Drawn from published
   descriptions: one integrated building of offset-stacked containers on
   columns in an aerodynamic metal skin; facade panels 4.90 m (two container
   axes); inclined (15°) glazed fronts at the north (sea) and south (land)
   ends; energy centre, labs and garage on the lower level, rooms above,
   plant and terrace on the roof; kerosene tanks; a helipad ≈155 m N and
   ≈239 m E of the station (Wikipedia heliport coordinates); a sea-water pump.
   ASSUMED: every dimension, the tank and pump positions, the mast.
   Axes: metres, +x east, −z north, y up (sea level 0).
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { makeNoise, padWeight, smoothstep } from '../noise';
import { aluminiumSkinTexture, glazingTexture, helipadTexture, seaIceMaterial, seaMaterial, standard } from '../materials';
import { Batcher, commonMaterials, container, latticeMast, makeZone, pipeline, tankFarm } from '../builders';

const PAD_Y = 35;          // station elevation, station_config.json (35 m)
const L = 53.9;            // 11 panels × 4.90 m (assumed count)
const W = 19.6;            // 8 container widths × 2.45 m (assumed)
const LEGS = 2.6;
const HB = 7.8;            // two container levels + skin
const TAN15 = Math.tan((15 * Math.PI) / 180);

const noise = makeNoise(76);
const coastZ = (x) => -232 + 0.00045 * x * x + (noise.fbm(x * 0.006, 4.2, 4) - 0.5) * 70;

const PADS = [
  { x: 0, z: 0, hx: 13, hz: 33, feather: 28, y: PAD_Y },
  { x: -64, z: 26, hx: 15, hz: 12, feather: 18, y: PAD_Y - 1.5 },
  { x: 239, z: -155, hx: 15, hz: 15, feather: 22, y: PAD_Y - 6 },
  { x: 36, z: -196, hx: 6, hz: 6, feather: 12, y: 6 },
  { x: 34, z: 10, hx: 5, hz: 5, feather: 10, y: PAD_Y },
  { x: -10, z: 54, hx: 20, hz: 8, feather: 14, y: PAD_Y },
];

function rawHeight(x, z) {
  const sd = z - coastZ(x);                     // distance inland from the shore line
  if (sd < 0) return -6 + Math.max(sd * 0.05, -20);
  const near = 0.3 + 0.7 * smoothstep(70, 260, Math.hypot(x, z * 0.7));
  const knolls = (noise.ridged(x * 0.0075, z * 0.0075, 5) * 40 + noise.fbm(x * 0.035, z * 0.035, 4) * 6) * near;
  const rise = 22 * smoothstep(0, 260, sd) + Math.max(0, z - 650) * 0.09;
  return 1.5 + knolls * smoothstep(0, 90, sd) + rise;
}

function height(x, z) {
  let h = rawHeight(x, z);
  for (const p of PADS) {
    const w = padWeight(x, z, p);
    if (w > 0) h += (p.y - h) * w;
  }
  return h;
}

export const bharati = {
  id: 'bharati',
  label: 'Bharati',
  terrain: {
    inner: 900,
    outer: 7000,
    height,
    palette: { rockA: '#6A6866', rockB: '#3B3A39', snow: '#EEF2F7', lake: '#9DB3C8' },
    snow(x, z, y, ny) {
      const sheltered = noise.fbm(x * 0.02 + 11, z * 0.02, 3);
      const plateau = smoothstep(500, 800, z);
      return Math.min(1, Math.max(0, 0.32 + (sheltered - 0.5) * 2.4 + (ny - 0.97) * 6 + plateau * 1.5 + (y < 3 ? 0.4 : 0)));
    },
    lake: null,
  },
  sea: { shoreZ: -230 },
  camera: { position: [78, PAD_Y + 52, 92], target: [-4, PAD_Y + 4, -12] },
  orbit: { minDistance: 45, maxDistance: 420 },
  build,
};

/** Bharati's main building skin: the chamfered cross-section extruded along N–S. */
function skinProfile() {
  const s = new THREE.Shape();
  const top = HB; const ch = 2.4; const bc = 0.9;
  s.moveTo(-W / 2 + bc, 0);
  s.lineTo(W / 2 - bc, 0);
  s.lineTo(W / 2, bc);
  s.lineTo(W / 2, top - ch);
  s.lineTo(W / 2 - ch * 1.5, top);
  s.lineTo(-W / 2 + ch * 1.5, top);
  s.lineTo(-W / 2, top - ch);
  s.lineTo(-W / 2, bc);
  s.closePath();
  return s;
}

/** One glazed end: the profile pushed out so the front leans 15° outward at the top. */
function glazedEnd(profile, skinMat, glassMat) {
  const g = new THREE.ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false });
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    if (pos.getZ(i) > 0.5) pos.setZ(i, 0.5 + pos.getY(i) * TAN15);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, [glassMat, skinMat]);
}

function build(group) {
  const m = commonMaterials();
  const b = new Batcher();
  const y0 = PAD_Y;

  // ── Main building ─────────────────────────────────────────
  const skinTex = aluminiumSkinTexture();
  skinTex.repeat.set(1 / 2.45, 1 / 4.9);
  const skin = standard('#FFFFFF', { map: skinTex, roughness: 0.42, metalness: 0.35 });
  const glassTex = glazingTexture(7, 3);
  glassTex.repeat.set(1 / W, 1 / (HB - 1.2));
  glassTex.offset.set(0.5, -0.1);
  const glass = standard('#FFFFFF', { map: glassTex, roughness: 0.12, metalness: 0.55 });
  const profile = skinProfile();

  const body = new THREE.ExtrudeGeometry(profile, { depth: L, bevelEnabled: false });
  body.translate(0, y0 + LEGS, -L / 2);
  const bodyMesh = new THREE.Mesh(body, skin);
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  const south = glazedEnd(profile, skin, glass);
  south.position.set(0, y0 + LEGS, L / 2);
  const north = glazedEnd(profile, skin, glass);
  north.position.set(0, y0 + LEGS, -L / 2);
  north.rotation.y = Math.PI;
  [south, north].forEach((e) => { e.castShadow = true; e.receiveShadow = true; group.add(e); });

  // Small windows: rooms on the upper level, labs below (≈5 % glazing in total).
  const win = standard('#27313C', { roughness: 0.15, metalness: 0.6 });
  for (let k = -5; k <= 5; k += 1) {
    [-1, 1].forEach((side) => {
      b.box(win, 0.08, 1.05, 1.5, side * (W / 2 + 0.02), y0 + LEGS + 5.4, k * 4.9 + 1.2);
      if (k % 2 === 0) b.box(win, 0.08, 0.8, 2.2, side * (W / 2 + 0.02), y0 + LEGS + 2.2, k * 4.9 - 0.6);
    });
  }

  // Columns on a 7.35 m × 9.8 m grid, with braces under the building.
  const xs = [-7.35, 0, 7.35]; const zs = [-24.5, -14.7, -4.9, 4.9, 14.7, 24.5];
  xs.forEach((x) => zs.forEach((z) => {
    b.cylinder(m.darkSteel, 0.32, 0.36, LEGS, x, y0 + LEGS / 2, z, 12);
    b.box(m.concrete, 1.2, 0.5, 1.2, x, y0 + 0.2, z);
  }));
  zs.slice(0, -1).forEach((z, i) => {
    b.strut(m.steel, [-7.35, y0 + 0.4, z], [-7.35, y0 + LEGS - 0.2, zs[i + 1]], 0.07);
    b.strut(m.steel, [7.35, y0 + 0.4, zs[i + 1]], [7.35, y0 + LEGS - 0.2, z], 0.07);
  });

  // Roof: plant enclosure (air handling), terrace railing, two antenna masts.
  const plant = standard('#8F969E', { roughness: 0.5, metalness: 0.4 });
  const roofY = y0 + LEGS + HB;
  b.box(plant, 9.2, 2.3, 16, 0, roofY + 1.15, 9);
  for (let i = -3; i <= 3; i += 1) b.box(m.darkSteel, 9.3, 0.08, 0.12, 0, roofY + 0.5 + (i + 3) * 0.28, 1.0);
  for (let z = -22; z <= -2; z += 2.5) {
    b.strut(m.galvanised, [-5.5, roofY, z], [-5.5, roofY + 1.1, z], 0.04, 4);
    b.strut(m.galvanised, [5.5, roofY, z], [5.5, roofY + 1.1, z], 0.04, 4);
  }
  b.strut(m.galvanised, [-5.5, roofY + 1.1, -22], [-5.5, roofY + 1.1, -2], 0.05, 4);
  b.strut(m.galvanised, [5.5, roofY + 1.1, -22], [5.5, roofY + 1.1, -2], 0.05, 4);
  b.strut(m.galvanised, [-3, roofY, -12], [-3, roofY + 6, -12], 0.08);
  b.strut(m.galvanised, [3.5, roofY + 2.3, 14], [3.5, roofY + 7, 14], 0.06);

  // External steel stair to the raised entrance (east side).
  b.box(m.galvanised, 3.2, 0.25, 6, W / 2 + 1.8, y0 + LEGS - 0.1, -3);
  for (let i = 0; i < 8; i += 1) b.box(m.steel, 3.0, 0.08, 0.7, W / 2 + 1.8, y0 + 0.3 + i * 0.3, 1.5 + i * 0.7);

  // ── Kerosene tank farm (west) ──────────────────────────────
  tankFarm(b, m, -64, y0 - 1.5, 26, { cols: 3, rows: 2, r: 3.6, h: 7.5 });

  // ── Sea-water pump house and pipeline ─────────────────────
  b.box(m.concrete, 5, 3.2, 4.4, 36, 6 + 1.6, -196);
  b.box(m.darkSteel, 5.4, 0.3, 4.8, 36, 6 + 3.3, -196);
  pipeline(b, m, [[36, -192], [20, -110], [6, -40], [3, -28]], height, 0.9);

  // ── Comms mast ────────────────────────────────────────────
  latticeMast(b, m, 34, y0, 10, 22, 0.4);

  // ── Garage / store containers (summer camp side, south) ──
  const contA = standard('#9B3B2E', { roughness: 0.6, metalness: 0.3 });
  const contB = standard('#3C5A73', { roughness: 0.6, metalness: 0.3 });
  [[-22, 52], [-15.5, 52], [-9, 52], [-22, 56], [-15.5, 56]].forEach(([x, z], i) => container(b, i % 2 ? contB : contA, m.darkSteel, x, y0, z));

  // ── Helipad ───────────────────────────────────────────────
  const pad = new THREE.Mesh(new THREE.CircleGeometry(12, 48), standard('#FFFFFF', { map: helipadTexture(), roughness: 1 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(239, PAD_Y - 6 + 0.08, -155);
  pad.receiveShadow = true;
  group.add(pad);

  b.build(group);

  // ── Sea and sea ice ───────────────────────────────────────
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), seaMaterial());
  sea.rotation.x = -Math.PI / 2; sea.position.y = 0;
  sea.receiveShadow = true;
  group.add(sea);
  const ice = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), seaIceMaterial(-230));
  ice.rotation.x = -Math.PI / 2; ice.position.y = 0.25;
  ice.receiveShadow = true;
  group.add(ice);

  // ── Zones (plan §2.3): sections of the one building, plus outbuildings ──
  const lo = y0 + LEGS; const mid = y0 + LEGS + 3.6; const top = y0 + LEGS + HB;
  return [
    makeZone('generator', { box: { x: 0, y: lo, z: 17.5, w: W + 0.6, h: 3.6, d: 19 }, ring: { x: 0, z: 17.5, y: y0, r: 15 } }),
    makeZone('heatingB', { box: { x: 0, y: lo, z: 0, w: W + 0.6, h: 3.6, d: 16 }, ring: { x: 0, z: 0, y: y0, r: 13 } }),
    makeZone('lab', { box: { x: 0, y: lo, z: -18, w: W + 0.6, h: 3.6, d: 20 }, ring: { x: 0, z: -18, y: y0, r: 15 } }),
    makeZone('livingQuarters', { box: { x: 0, y: mid, z: 0, w: W + 0.6, h: top - mid + 0.2, d: L + 0.6 }, ring: { x: 0, z: 0, y: y0, r: 31 } }),
    makeZone('heating', { box: { x: 0, y: top, z: 9, w: 10, h: 2.6, d: 17 }, ring: { x: 0, z: 9, y: y0, r: 11 } }),
    makeZone('storage', { box: { x: -64, y: y0 - 1.5, z: 26, w: 30, h: 8.6, d: 22 }, ring: { x: -64, z: 26, y: y0 - 1.5, r: 19 } }),
    makeZone('waterTank', { box: { x: 36, y: 6, z: -196, w: 6.5, h: 4.2, d: 6 }, ring: { x: 36, z: -196, y: 6, r: 7 } }),
    makeZone('commsMast', { box: { x: 34, y: y0, z: 10, w: 5, h: 23, d: 5 }, ring: { x: 34, z: 10, y: y0, r: 5.5 } }),
  ];
}
