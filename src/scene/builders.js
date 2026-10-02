/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — parametric building blocks.
   Static geometry is batched per material (one draw call per material per
   station). Each subsystem gets a pickable zone: an invisible shell that
   raycasts, tints steadily when the subsystem is in alert, and a flat ground
   ring in the status token colour. No pulsing, no blinking.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { srgb, standard } from './materials';

/** Collects transformed geometries per material and merges them into one mesh each. */
export class Batcher {
  constructor() { this.parts = new Map(); }

  add(geometry, material, matrix) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (matrix) g.applyMatrix4(matrix);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
    return g;
  }

  /** Box centred at (x, y, z) with optional yaw. */
  box(material, w, h, d, x, y, z, rotY = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), material, place(x, y, z, rotY));
  }

  cylinder(material, rTop, rBottom, h, x, y, z, seg = 16, rotX = 0, rotZ = 0) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotX, 0, rotZ)).setPosition(x, y, z);
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material, m);
  }

  /** A thin member from point a to point b (columns, braces, lattice). */
  strut(material, a, b, r = 0.08, seg = 6) {
    const va = new THREE.Vector3(...a); const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    const m = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(g, material, m);
  }

  build(group, { castShadow = true, receiveShadow = true } = {}) {
    this.parts.forEach((geoms, material) => {
      const merged = BufferGeometryUtils.mergeBufferGeometries(geoms, false);
      if (!merged) { console.error('[StationScene] geometry merge failed for a material'); return; }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    });
    this.parts.clear();
  }
}

export function place(x, y, z, rotY = 0) {
  return new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
}

/** Shared materials, created once per scene. */
export function commonMaterials() {
  return {
    steel: standard('#4B5058', { roughness: 0.55, metalness: 0.6 }),
    darkSteel: standard('#2E3237', { roughness: 0.6, metalness: 0.5 }),
    galvanised: standard('#A5ABB2', { roughness: 0.45, metalness: 0.55 }),
    tank: standard('#D9DCDF', { roughness: 0.42, metalness: 0.3 }),
    tankBand: standard('#8C2F25', { roughness: 0.5, metalness: 0.2 }),
    concrete: standard('#8E9094', { roughness: 0.95 }),
    gravel: standard('#5C5E62', { roughness: 1 }),
    pipe: standard('#9DA3A8', { roughness: 0.4, metalness: 0.6 }),
    dish: standard('#E3E6E9', { roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }),
    beaconOff: standard('#59606A', { roughness: 0.4 }),
  };
}

/** A 20 ft (6.06 × 2.44 × 2.59 m) shipping container, corrugated, with door end detail. */
export function container(b, mat, frameMat, x, y, z, rotY = 0, len = 6.06) {
  b.box(mat, len, 2.59, 2.44, x, y + 1.295, z, rotY);
  const c = Math.cos(rotY); const s = Math.sin(rotY);
  [-1, 1].forEach((e) => {
    const ex = x + c * e * (len / 2 - 0.08); const ez = z - s * e * (len / 2 - 0.08);
    b.box(frameMat, 0.16, 2.61, 2.46, ex, y + 1.295, ez, rotY);
  });
}

/** Vertical cylindrical fuel tanks in a low bunded enclosure. */
export function tankFarm(b, m, x0, y0, z0, { cols = 3, rows = 2, r = 3.4, h = 7, gap = 2.2, rotY = 0 } = {}) {
  const pitch = 2 * r + gap;
  const w = cols * pitch + 3; const d = rows * pitch + 3;
  const c = Math.cos(rotY); const s = Math.sin(rotY);
  const at = (lx, lz) => [x0 + lx * c + lz * s, z0 - lx * s + lz * c];
  // bund wall
  [[0, -d / 2, w, 0.4], [0, d / 2, w, 0.4], [-w / 2, 0, 0.4, d], [w / 2, 0, 0.4, d]].forEach(([lx, lz, ww, dd]) => {
    const [px, pz] = at(lx, lz);
    b.box(m.concrete, ww, 1.1, dd, px, y0 + 0.55, pz, rotY);
  });
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const [px, pz] = at((i - (cols - 1) / 2) * pitch, (j - (rows - 1) / 2) * pitch);
      b.cylinder(m.tank, r, r, h, px, y0 + h / 2, pz, 28);
      b.cylinder(m.tank, r * 0.97, r, 0.6, px, y0 + h + 0.3, pz, 28);
      b.cylinder(m.tankBand, r + 0.02, r + 0.02, 0.35, px, y0 + h * 0.82, pz, 28);
    }
  }
  return { w, d };
}

/** A tapering lattice mast with a dish and an (unlit) beacon. */
export function latticeMast(b, m, x, y, z, height = 20, dishYaw = 0.6) {
  const base = 1.4; const top = 0.5;
  const corners = (t) => { const r = base + (top - base) * t; return [[-r, -r], [r, -r], [r, r], [-r, r]]; };
  for (let k = 0; k < 4; k += 1) {
    const a = corners(0)[k]; const c = corners(1)[k];
    b.strut(m.galvanised, [x + a[0], y, z + a[1]], [x + c[0], y + height, z + c[1]], 0.07);
  }
  const levels = 8;
  for (let l = 0; l < levels; l += 1) {
    const t0 = l / levels; const t1 = (l + 1) / levels;
    const p0 = corners(t0); const p1 = corners(t1);
    for (let k = 0; k < 4; k += 1) {
      const a = p0[k]; const c = p1[(k + 1) % 4];
      b.strut(m.galvanised, [x + a[0], y + t0 * height, z + a[1]], [x + c[0], y + t1 * height, z + c[1]], 0.035, 4);
      const n = p1[k]; const n2 = p1[(k + 1) % 4];
      b.strut(m.galvanised, [x + n[0], y + t1 * height, z + n[1]], [x + n2[0], y + t1 * height, z + n2[1]], 0.035, 4);
    }
  }
  const dish = new THREE.SphereGeometry(1.5, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.32);
  const dm = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.PI / 2 - 0.35, dishYaw, 0, 'YXZ')).setPosition(x + Math.sin(dishYaw) * 1.2, y + height * 0.72, z + Math.cos(dishYaw) * 1.2);
  b.add(dish, m.dish, dm);
  b.cylinder(m.beaconOff, 0.18, 0.18, 0.4, x, y + height + 0.3, z, 10);
}

/** Pipeline on short supports from a to b (2D points at height y). */
export function pipeline(b, m, pts, heightAt, lift = 0.8) {
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, z0] = pts[i]; const [x1, z1] = pts[i + 1];
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 6));
    for (let k = 0; k < steps; k += 1) {
      const ta = k / steps; const tb = (k + 1) / steps;
      const ax = x0 + (x1 - x0) * ta; const az = z0 + (z1 - z0) * ta;
      const bx = x0 + (x1 - x0) * tb; const bz = z0 + (z1 - z0) * tb;
      const ya = heightAt(ax, az) + lift; const yb = heightAt(bx, bz) + lift;
      b.strut(m.pipe, [ax, ya, az], [bx, yb, bz], 0.13, 8);
      b.strut(m.darkSteel, [ax, ya - lift, az], [ax, ya, az], 0.05, 4);
    }
  }
}

// ── Zones: picking, alert tint and ground ring ─────────────────

const SHELL_GEO = new THREE.BoxGeometry(1, 1, 1);

/**
 * A pickable zone for a subsystem. `box` = {x, y, z, w, h, d, rotY} encloses the
 * physical thing; `ring` = {x, z, y, r} is the ground ring's centre and radius.
 */
export function makeZone(id, { box, ring }) {
  const shellMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
  const shell = new THREE.Mesh(SHELL_GEO, shellMat);
  shell.scale.set(box.w, box.h, box.d);
  shell.position.set(box.x, box.y + box.h / 2, box.z);
  shell.rotation.y = box.rotY || 0;
  shell.userData.buildingId = id;
  shell.visible = false;            // raycasting ignores visibility in r128: still pickable
  shell.renderOrder = 2;

  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const ringMesh = new THREE.Mesh(new THREE.RingGeometry(ring.r, ring.r + Math.max(0.6, ring.r * 0.06), 72), ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(ring.x, ring.y + 0.18, ring.z);
  ringMesh.visible = false;
  ringMesh.renderOrder = 3;
  return { id, shell, ring: ringMesh, center: new THREE.Vector3(box.x, box.y + box.h, box.z) };
}

/**
 * Apply the zone's visual state. Alert: steady tint + ring in the status colour.
 * Selected: accent ring (and a light accent tint if normal). Hover: faint accent tint.
 */
export function styleZone(zone, { level, selected, hovered }, colours) {
  const alert = level === 'warning' || level === 'critical';
  if (alert) {
    zone.shell.visible = true;
    zone.shell.material.color.copy(colours[level]);
    zone.shell.material.opacity = hovered ? 0.42 : 0.32;
    zone.ring.visible = true;
    zone.ring.material.color.copy(selected ? colours.accent : colours[level]);
  } else if (selected || hovered) {
    zone.shell.visible = true;
    zone.shell.material.color.copy(colours.accent);
    zone.shell.material.opacity = selected ? 0.22 : 0.14;
    zone.ring.visible = selected;
    zone.ring.material.color.copy(colours.accent);
  } else {
    zone.shell.visible = false;
    zone.ring.visible = false;
  }
}

export function statusColours(hex) {
  return {
    warning: srgb(hex.warning), critical: srgb(hex.critical), normal: srgb(hex.normal), accent: srgb(hex.accent),
  };
}
