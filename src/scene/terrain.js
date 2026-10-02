/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — procedural heightfield terrain.
   Two nested grids: a fine inner tile around the station and a coarse
   outer tile out to the horizon. Inside the inner tile the outer grid is
   lowered, so the coarse surface never pokes through the fine one; the
   two meet at the inner edge, where the fog has already started.
   Rock versus snow, and frozen lakes, are per-vertex weights that the
   terrain shader (materials.js) breaks up into natural edges.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { smoothstep } from './noise';
import { terrainMaterial } from './materials';

function grid(size, seg, def, { lowerInside = 0, material }) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i); const z = pos.getZ(i);
    let y = def.height(x, z);
    if (lowerInside) {
      const d = Math.max(Math.abs(x), Math.abs(z));
      y -= 6 * (1 - smoothstep(lowerInside - 40, lowerInside, d));
    }
    pos.setY(i, y);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const snow = new Float32Array(pos.count);
  const lake = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i); const z = pos.getZ(i);
    snow[i] = def.snow(x, z, pos.getY(i), nrm.getY(i));
    lake[i] = def.lake ? def.lake(x, z) : 0;
  }
  g.setAttribute('aSnow', new THREE.BufferAttribute(snow, 1));
  g.setAttribute('aLake', new THREE.BufferAttribute(lake, 1));
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Build the station's terrain. Returns the group and the material (whose uniforms
 * the scene updates with the sun direction each frame).
 */
export function buildTerrain(def, tier) {
  const material = terrainMaterial(def.palette);
  const far = material.clone();
  far.onBeforeCompile = material.onBeforeCompile;
  far.customProgramCacheKey = material.customProgramCacheKey;
  far.userData.uniforms = material.userData.uniforms;
  far.polygonOffset = true; far.polygonOffsetFactor = 2; far.polygonOffsetUnits = 4;

  const group = new THREE.Group();
  const innerHalf = def.inner / 2;
  const inner = grid(def.inner, tier.terrainSeg, def, { material });
  inner.castShadow = true;
  group.add(inner);
  group.add(grid(def.outer, Math.round(tier.terrainSeg / 2), def, { lowerInside: innerHalf, material: far }));
  return { group, material };
}
