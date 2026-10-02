/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — snow, animated entirely on the GPU (no per-frame CPU loop).
     Blowing snow  ground-hugging streaks that travel with the wind; their
                   opacity and count follow the live wind speed (bindings.js).
     Snowfall      a faint DECORATIVE flurry — not data (there is no
                   precipitation field); listed as such in "About this view".
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { rng } from './noise';

const AREA = 340;   // metres, square, centred on the station

/** Coarse height lookup over the snow area, so streak heights cost nothing to recompute. */
function heightGrid(heightAt, cx, cz, n = 96) {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) data[j * n + i] = heightAt(cx - AREA / 2 + (i / (n - 1)) * AREA, cz - AREA / 2 + (j / (n - 1)) * AREA);
  }
  return (x, z) => {
    const u = Math.max(0, Math.min(n - 1.001, ((x - cx + AREA / 2) / AREA) * (n - 1)));
    const v = Math.max(0, Math.min(n - 1.001, ((z - cz + AREA / 2) / AREA) * (n - 1)));
    const i = Math.floor(u); const j = Math.floor(v); const fu = u - i; const fv = v - j;
    const a = data[j * n + i]; const b = data[j * n + i + 1]; const c = data[(j + 1) * n + i]; const d = data[(j + 1) * n + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  };
}

export function createDrift({ heightAt, center, count }) {
  const r = rng(29);
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -1, 0, 0.5, -1, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const origin = new Float32Array(count * 2);
  const hts = new Float32Array(count * 2);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    origin[i * 2] = center.x + (r() - 0.5) * AREA;
    origin[i * 2 + 1] = center.z + (r() - 0.5) * AREA;
    rand[i] = r();
  }
  quad.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 2));
  const hAttr = new THREE.InstancedBufferAttribute(hts, 2);
  quad.setAttribute('aH', hAttr);
  quad.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 1));
  quad.instanceCount = count;

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) }, uIntensity: { value: 0 },
      uTravel: { value: 26 }, uColor: { value: new THREE.Color(0xeef3f8) },
    },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute vec2 aOrigin; attribute vec2 aH; attribute float aRand;
      uniform float uTime; uniform vec2 uWind; uniform float uIntensity; uniform float uTravel;
      varying float vAlpha;
      void main() {
        float speed = 6.0 + 14.0 * uIntensity;
        float phase = fract(uTime * speed / uTravel + aRand * 7.31);
        vec2 xz = aOrigin + uWind * phase * uTravel;
        float lift = 0.12 + pow(fract(aRand * 13.7), 2.2) * (0.6 + 2.6 * uIntensity);
        vec3 center = vec3(xz.x, mix(aH.x, aH.y, phase) + lift, xz.y);
        vec3 axis = normalize(vec3(uWind.x, 0.0, uWind.y));
        vec3 toCam = normalize(cameraPosition - center);
        vec3 side = normalize(cross(axis, toCam));
        float len = 0.8 + 2.4 * uIntensity * (0.5 + fract(aRand * 3.1));
        vec3 p = center + axis * position.y * len * 0.5 + side * position.x * 0.05;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float visible = step(fract(aRand * 5.7), uIntensity * 1.1);
        vAlpha = sin(phase * 3.14159) * visible * (0.25 + 0.35 * uIntensity);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform vec3 uColor; varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(quad, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  const lookup = heightGrid(heightAt, center.x, center.z);
  let lastDir = null;
  /** Point the streaks along the wind (direction the wind blows TOWARD, as a unit xz vector). */
  function setDirection(dx, dz) {
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len; const uz = dz / len;
    mat.uniforms.uWind.value.set(ux, uz);
    if (lastDir && ux * lastDir[0] + uz * lastDir[1] > 0.94) return;   // < ~20° change: keep heights
    lastDir = [ux, uz];
    const travel = mat.uniforms.uTravel.value;
    for (let i = 0; i < count; i += 1) {
      const ox = origin[i * 2]; const oz = origin[i * 2 + 1];
      hts[i * 2] = lookup(ox, oz);
      hts[i * 2 + 1] = lookup(ox + ux * travel, oz + uz * travel);
    }
    hAttr.needsUpdate = true;
  }
  setDirection(1, 0);

  return {
    mesh,
    setDirection,
    setIntensity(v) { mat.uniforms.uIntensity.value = v; mesh.visible = v > 0.005; },
    setTime(t) { mat.uniforms.uTime.value = t; },
    setCount(n) { quad.instanceCount = Math.min(count, n); },
    dispose() { quad.dispose(); mat.dispose(); },
  };
}

/** Faint decorative snowfall in a box around the station. */
export function createSnowfall({ center, count }) {
  const r = rng(53);
  const pos = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    pos[i * 3] = (r() - 0.5) * 220; pos[i * 3 + 1] = r() * 70; pos[i * 3 + 2] = (r() - 0.5) * 220;
    rand[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3(center.x, center.y, center.z) },
      uWind: { value: new THREE.Vector2(1, 0) }, uDrift: { value: 0 }, uPx: { value: 1 },
    },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute float aRand;
      uniform float uTime; uniform vec3 uOrigin; uniform vec2 uWind; uniform float uDrift; uniform float uPx;
      varying float vA;
      void main() {
        vec3 p = position;
        float fall = 0.6 + 0.7 * aRand;
        p.y = mod(p.y - uTime * fall, 70.0);
        p.xz += uWind * uTime * (1.0 + 9.0 * uDrift) + vec2(sin(uTime * 0.7 + aRand * 40.0), cos(uTime * 0.5 + aRand * 30.0)) * 0.6;
        p.xz = mod(p.xz + 110.0, 220.0) - 110.0;
        vec4 mvPosition = modelViewMatrix * vec4(uOrigin + p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(uPx * (0.6 + aRand) * 90.0 / -mvPosition.z, 1.0, 6.0 * uPx);
        vA = 0.55;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.15, d) * vA;
        gl_FragColor = vec4(vec3(0.96, 0.97, 1.0), a);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
        #include <fog_fragment>
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return {
    mesh: points,
    setTime(t) { mat.uniforms.uTime.value = t; },
    setWind(dx, dz, drift) { mat.uniforms.uWind.value.set(dx, dz); mat.uniforms.uDrift.value = drift; },
    setPixelRatio(px) { mat.uniforms.uPx.value = px; },
    setCount(n) { g.setDrawRange(0, Math.min(count, n)); },
    dispose() { g.dispose(); mat.dispose(); },
  };
}
