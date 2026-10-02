/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — materials. Everything is generated in code: no image files,
   no external assets (CSP: img-src 'self' data: blob:; canvas textures are
   uploaded straight from a canvas element).

   Colours are given as sRGB hex and converted to linear, because the
   renderer writes sRGB output; a status token therefore appears on screen
   as exactly its token value.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';

/** sRGB hex → linear THREE.Color. */
export function srgb(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

export function standard(hex, { roughness = 0.7, metalness = 0.05, ...rest } = {}) {
  return new THREE.MeshStandardMaterial({ color: srgb(hex), roughness, metalness, ...rest });
}

// GLSL value noise shared by the terrain and snow shaders.
const NOISE_GLSL = /* glsl */`
float aurH21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float aurVN(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(aurH21(i), aurH21(i + vec2(1.0, 0.0)), u.x), mix(aurH21(i + vec2(0.0, 1.0)), aurH21(i + 1.0), u.x), u.y);
}
float aurFbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * aurVN(p); p *= 2.03; a *= 0.5; } return s; }
`;

/**
 * Terrain material. Per-vertex attributes from the heightfield:
 *   aSnow  base snow cover (slope, altitude, shelter), broken up here by noise into
 *          natural patch edges at metre scale;
 *   aLake  frozen-lake / sea-ice surface.
 * Rock is a banded gneiss grey-brown; snow is blue-white with a faint, sparse
 * sun glint (no bloom). Normals get small procedural relief (sastrugi on snow,
 * coarser on rock) so the ground reads at close range without textures.
 */
export function terrainMaterial({ rockA = '#57524C', rockB = '#34312E', snow = '#EEF2F7', lake = '#8FA9C2', scale = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const uniforms = {
    uRockA: { value: srgb(rockA) },
    uRockB: { value: srgb(rockB) },
    uSnow: { value: srgb(snow) },
    uLake: { value: srgb(lake) },
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
    uSun: { value: 1 },
    uScale: { value: scale },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aSnow; attribute float aLake;
varying float vSnow; varying float vLake; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSnow = aSnow; vLake = aLake; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uRockA; uniform vec3 uRockB; uniform vec3 uSnow; uniform vec3 uLake; uniform vec3 uSunView; uniform float uSun; uniform float uScale;
varying float vSnow; varying float vLake; varying vec3 vWPos;
${NOISE_GLSL}
float aurSnowMask;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 wp = vWPos.xz * uScale;
float n1 = aurFbm(wp * 0.11);
float n2 = aurFbm(wp * 0.9 + 7.3);
float bands = 0.5 + 0.5 * sin(wp.x * 0.35 + wp.y * 0.12 + n1 * 6.0);
vec3 rock = mix(uRockB, uRockA, clamp(n1 * 1.2 + bands * 0.25 - 0.1, 0.0, 1.0));
rock *= 0.9 + 0.18 * n2;
aurSnowMask = smoothstep(0.42, 0.58, vSnow + (n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.18);
vec3 snowCol = uSnow * (0.94 + 0.06 * n2);
vec3 lakeCol = uLake * (0.88 + 0.24 * aurFbm(wp * 0.05 + 3.1)) + vec3(0.04) * smoothstep(0.7, 0.75, aurVN(wp * 0.6));
diffuseColor.rgb = mix(mix(rock, snowCol, aurSnowMask), lakeCol, vLake);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(mix(0.95, 0.78, aurSnowMask), 0.32, vLake);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float e = 0.35;
  float amp = mix(mix(0.55, 0.16, aurSnowMask), 0.03, vLake);
  vec2 q = vWPos.xz * uScale * 0.6;
  float h0 = aurFbm(q); float hx = aurFbm(q + vec2(e, 0.0)); float hz = aurFbm(q + vec2(0.0, e));
  vec3 g = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * amp;
  normal = normalize(normal + (viewMatrix * vec4(g, 0.0)).xyz);
}`)
      .replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );', `
{
  vec3 V = normalize(vViewPosition);
  vec3 H = normalize(uSunView + V);
  vec2 cell = floor(vWPos.xz * uScale * 9.0);
  float glint = step(0.9965, aurH21(cell)) * pow(max(dot(normal, H), 0.0), 60.0);
  outgoingLight += vec3(glint) * aurSnowMask * (1.0 - vLake) * uSun * 0.6;
}
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`);
  };
  mat.customProgramCacheKey = () => 'aurora-terrain';
  return mat;
}

/** Sea with a wind-ruffled sheen; sea ice is drawn by `seaIceMaterial` above it. */
export function seaMaterial() {
  return standard('#1E2B38', { roughness: 0.28, metalness: 0.15 });
}

/**
 * Sea ice: floes from thresholded noise, denser (fast ice) near the shore line `uShoreZ`
 * and breaking up seawards (−z is north, i.e. seawards, at Bharati).
 */
export function seaIceMaterial(shoreZ) {
  const mat = new THREE.MeshStandardMaterial({ color: srgb('#E6ECF2'), roughness: 0.8, metalness: 0, transparent: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShoreZ = { value: shoreZ };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uShoreZ; varying vec3 vWPos;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float off = clamp((uShoreZ - vWPos.z) / 1600.0, 0.0, 1.0);
float n = aurFbm(vWPos.xz * 0.012) * 0.75 + aurVN(vWPos.xz * 0.08) * 0.25;
float cover = smoothstep(0.22 + off * 0.3, 0.25 + off * 0.3, n);
diffuseColor.a = cover;
diffuseColor.rgb *= 0.86 + 0.14 * aurFbm(vWPos.xz * 0.004 + 2.0) + 0.05 * aurVN(vWPos.xz * 0.15);`);
  };
  mat.customProgramCacheKey = () => 'aurora-sea-ice';
  return mat;
}

// ── Canvas textures ───────────────────────────────────────────

function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
}

function grain(ctx, w, h, amount, seed = 3) {
  const img = ctx.getImageData(0, 0, w, h);
  let s = seed;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const d = ((s / 2147483647) - 0.5) * amount;
    img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Bharati's metal skin: one tile = one 4.90 m facade panel (two container axes, per
 * the facade engineer's description) by 2.45 m; brushed aluminium with joint lines.
 */
export function aluminiumSkinTexture() {
  return canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#C9CED4'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { ctx.fillStyle = `rgba(255,255,255,${0.03 + 0.03 * Math.sin(y * 0.7)})`; ctx.fillRect(0, y, w, 1); }
    grain(ctx, w, h, 10);
    ctx.fillStyle = '#7E868F';
    ctx.fillRect(0, 0, w, 5);      // joint along the panel's long edge
    ctx.fillRect(0, 0, 4, h);      // joint across
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, 5, w, 2); ctx.fillRect(4, 0, 2, h);
  });
}

/** Tan insulated panels with vertical ribs (Maitri's main building). */
export function tanPanelTexture() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#BFA77F'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(x, 0, 3, h);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x + 3, 0, 2, h);
    }
    ctx.fillStyle = 'rgba(70,55,35,0.35)'; ctx.fillRect(0, 0, 3, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.05)'); grad.addColorStop(1, 'rgba(60,45,25,0.12)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 12, 7);
  });
}

/** Corrugated steel for shipping containers, tinted per container. */
export function corrugatedTexture(hex) {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = hex; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 12) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, 0, 4, h);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 6, 0, 3, h);
    }
    grain(ctx, w, h, 14, 11);
  });
}

/** Triple-glazed curtain wall: dark glass with a soft sky reflection and mullions. */
export function glazingTexture(cols = 6, rows = 3) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#5C7189'); g.addColorStop(0.55, '#26313D'); g.addColorStop(1, '#171D24');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(w * 0.15, 0); ctx.lineTo(w * 0.45, 0); ctx.lineTo(w * 0.25, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9BA3AC';
    for (let i = 0; i <= cols; i += 1) ctx.fillRect(Math.min(w - 6, (i * w) / cols), 0, 6, h);
    for (let j = 0; j <= rows; j += 1) ctx.fillRect(0, Math.min(h - 6, (j * h) / rows), w, 6);
  });
}

/** Window strip on a tan wall: a row of small windows every `spacing` metres. */
export function windowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#5E5240'; ctx.fillRect(34, 34, 60, 50);
    const g = ctx.createLinearGradient(0, 38, 0, 80);
    g.addColorStop(0, '#6E8197'); g.addColorStop(1, '#232B35');
    ctx.fillStyle = g; ctx.fillRect(38, 38, 52, 42);
  });
}

/** Helipad marking: a white H and circle on a dark gravel pad. */
export function helipadTexture() {
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4A4D52'; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 30, 5);
    ctx.strokeStyle = '#E9ECEF'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#E9ECEF';
    ctx.fillRect(w * 0.36, h * 0.3, 16, h * 0.4); ctx.fillRect(w * 0.64 - 16, h * 0.3, 16, h * 0.4); ctx.fillRect(w * 0.36, h * 0.47, w * 0.28, 16);
  });
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** The Indian national flag (3:2), drawn to the flag code's proportions. */
export function flagTexture() {
  const t = canvasTexture(300, 200, (ctx, w, h) => {
    ctx.fillStyle = '#FF9933'; ctx.fillRect(0, 0, w, h / 3);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, h / 3, w, h / 3);
    ctx.fillStyle = '#138808'; ctx.fillRect(0, (2 * h) / 3, w, h / 3);
    ctx.strokeStyle = '#000080'; ctx.lineWidth = 3;
    const r = h / 6 - 4;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); ctx.lineWidth = 1.2; ctx.stroke();
    }
  });
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
