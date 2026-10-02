/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — sky, sun and haze, driven by the sun's position at the
   replay instant (lib/solar.js) and by the drift intensity (wind).
   Restrained on purpose: a gradient sky with a soft glow toward the sun,
   one shadow-casting sun, a hemisphere fill, distance haze. No bloom,
   no lens flare, no aurora.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { atmosphere, visibilityMetres } from './bindings';
import { srgb } from './materials';

/** Unit vector toward the sun: azimuth clockwise from north (−z), east = +x. */
export function sunVector(elevationDeg, azimuthDeg) {
  const e = (elevationDeg * Math.PI) / 180; const a = (azimuthDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

export function createAtmosphere(scene, { shadowSize, shadowExtent }) {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uHaze: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uSun; uniform float uHaze;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uZenith, pow(h, 0.5));
        vec2 hd = normalize(d.xz + 1e-5); vec2 hs = normalize(uSun.xz + 1e-5);
        float toward = max(dot(hd, hs), 0.0);
        c += uGlow * pow(toward, 3.0) * exp(-h * 6.0) * 0.9;
        float sd = max(dot(d, normalize(uSun)), 0.0);
        c += uGlow * pow(sd, 400.0) * 1.5 * step(-0.02, uSun.y);
        c = mix(c, uHorizon, uHaze * (1.0 - h * 0.6));
        if (d.y < 0.0) c = uHorizon;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 2400 });
  scene.add(sun);
  scene.add(sun.target);
  // A faint, fixed cool fill so the station stays legible in polar night (moon/skylight stand-in).
  // Cool "moonlight" fill: dim by day, the main light at night so terrain and buildings stay legible.
  const fill = new THREE.DirectionalLight(srgb('#9DB4D8'), 0.3);
  fill.position.set(-300, 500, 200);
  scene.add(fill);
  scene.add(fill.target);

  // Stars: a cheap point dome, visible only once the sky is dark.
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(900 * 3);
  let seed = 17;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i += 1) {
    const u = r(); const v = 0.06 + 0.94 * r();
    const th = u * Math.PI * 2; const y = v; const rr = Math.sqrt(1 - y * y);
    sp.set([Math.cos(th) * rr, y, Math.sin(th) * rr], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xdfe8f5, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  scene.add(stars);

  scene.fog = new THREE.Fog(0xffffff, 200, 2400);

  const sunDir = new THREE.Vector3(0, 1, 0);

  /**
   * Apply the sun position and drift; `focus` = the point the shadow camera centres on.
   * The moonlight fill comes from high behind the viewer (`camPos`), so the faces the
   * operator looks at stay legible at night.
   */
  function update({ elevation, azimuth }, drift, focus, camPos) {
    const a = atmosphere(elevation);
    sunDir.copy(sunVector(Math.max(elevation, 1.5), azimuth));
    sun.position.copy(focus).addScaledVector(sunDir, 900);
    sun.target.position.copy(focus);
    sun.intensity = a.sunIntensity;
    sun.color.copy(srgb(a.sunColor));
    sun.castShadow = a.sunIntensity > 0.05;
    fill.intensity = a.moon;
    if (camPos) {
      const back = camPos.clone().sub(focus).setY(0).normalize();
      fill.position.copy(focus).addScaledVector(back, 300).add(new THREE.Vector3(0, 520, 0));
      fill.target.position.copy(focus);
    }
    starMat.opacity = Math.max(0, Math.min(0.8, (-elevation - 6) / 8)) * (1 - Math.min(1, drift * 1.5));
    hemi.color.copy(srgb(a.hemiSky));
    hemi.groundColor.copy(srgb(a.hemiGround));
    hemi.intensity = a.hemiIntensity;
    skyMat.uniforms.uZenith.value.copy(srgb(a.zenith));
    skyMat.uniforms.uHorizon.value.copy(srgb(a.horizon));
    skyMat.uniforms.uGlow.value.copy(srgb(a.glow));
    skyMat.uniforms.uSun.value.copy(sunVector(elevation, azimuth));
    skyMat.uniforms.uHaze.value = Math.min(0.85, drift * 0.9);
    // Haze: fog colour = the horizon, so distant terrain dissolves into the sky.
    scene.fog.color.copy(srgb(a.horizon));
    scene.fog.near = 120 - 100 * Math.min(1, drift);
    scene.fog.far = visibilityMetres(drift);
    return { exposure: a.exposure, sunIntensity: a.sunIntensity, sunDir };
  }

  function dispose() {
    sky.geometry.dispose(); skyMat.dispose(); starGeo.dispose(); starMat.dispose();
  }

  return { update, sky, sun, stars, dispose, sunDir };
}
