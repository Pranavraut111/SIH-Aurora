/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — scene engine (three r128). Owns the renderer, the camera
   and orbit controls, the station worlds, picking, the render loop and
   the station-switch transition. React (StationScene3D.jsx) only feeds
   it props.

   Render loop: frames are drawn on demand. Something that changes over
   time (blowing snow, decorative snowfall, camera damping, a transition)
   requests frames; with nothing moving, no frames are drawn. The loop
   stops while the tab is hidden or the canvas is off-screen.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { solarPosition } from '../lib/solar';
import { ACCENT_HEX, STATUS_HEX, TIER, driftIntensity, levelOf, smoothToward } from './bindings';
import { buildTerrain } from './terrain';
import { createAtmosphere } from './atmosphere';
import { createDrift, createSnowfall } from './snow';
import { statusColours, styleZone } from './builders';
import { bharati } from './stations/bharati';
import { maitri } from './stations/maitri';

export const STATION_DEFS = { bharati, maitri };

const HORIZON_MIN = 0.1;   // keep the horizon at least 10 % below the top edge when fitting

export class SceneEngine {
  constructor(container, { tier = 'high', reducedMotion = false, coords = {}, prevailingWind = {}, callbacks = {} }) {
    this.container = container;
    this.tierName = tier;
    this.tier = TIER[tier];
    this.reducedMotion = reducedMotion;
    this.coords = coords;                 // {stationId: [lat, lon]}
    this.prevailingWind = prevailingWind; // {stationId: degrees the wind blows FROM}
    this.cb = callbacks;
    this.worlds = {};
    this.stationId = null;
    this.alerts = {};
    this.selected = null;
    this.hovered = null;
    this.avoidBottom = 0;
    this.env = { replayMs: null, windKmh: null, windFromDeg: null };
    this.drift = null;                    // smoothed drift intensity
    this.time = 0;
    this.needsFrame = true;
    this.running = false;
    this.visible = true;
    this.lastSunCalc = -Infinity;
    this.frameTimes = [];
    this.colours = statusColours({ ...STATUS_HEX, accent: ACCENT_HEX });

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.dpr));
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    // Crossfade layer: a 2D snapshot of the last frame that fades out over the new one.
    const fade = document.createElement('canvas');
    fade.setAttribute('aria-hidden', 'true');
    Object.assign(fade.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', opacity: '0' });
    container.appendChild(fade);
    this.fadeCanvas = fade;

    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = !reducedMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.08;
    this.controls.addEventListener('change', () => this.request());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.down = null;
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    this.onContextLost = this.onContextLost.bind(this);
    this.loop = this.loop.bind(this);
    renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    renderer.domElement.addEventListener('pointerleave', () => this.setHover(null));
    renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (window.IntersectionObserver) {
      this.io = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; if (this.visible) this.request(); });
      this.io.observe(container);
    }
  }

  // ── Worlds ─────────────────────────────────────────────────

  buildWorld(id) {
    if (this.worlds[id]) return this.worlds[id];
    const def = STATION_DEFS[id];
    const scene = new THREE.Scene();
    const { group: terrain, material: terrainMat } = buildTerrain(def.terrain, this.tier);
    scene.add(terrain);
    const site = new THREE.Group();
    const zones = def.build(site);
    scene.add(site);
    zones.forEach((z) => { scene.add(z.shell); scene.add(z.ring); });
    const target = new THREE.Vector3(...def.camera.target);
    const atmos = createAtmosphere(scene, { shadowSize: this.tier.shadow, shadowExtent: 150 });
    const center = new THREE.Vector3(target.x, target.y, target.z);
    const drift = createDrift({ heightAt: def.terrain.height, center, count: TIER.high.drift });
    drift.setCount(this.tier.drift);
    scene.add(drift.mesh);
    const snowfall = createSnowfall({ center: new THREE.Vector3(target.x, target.y - 8, target.z), count: TIER.high.snow });
    snowfall.setCount(this.tier.snow);
    snowfall.setPixelRatio(this.renderer.getPixelRatio());
    scene.add(snowfall.mesh);
    const world = { id, def, scene, zones, terrainMat, atmos, drift, snowfall, target };
    this.worlds[id] = world;
    return world;
  }

  get world() { return this.worlds[this.stationId]; }

  /** Show a station. `transition`: 'none' | 'crossfade'. */
  setStation(id, { transition = 'none' } = {}) {
    if (!STATION_DEFS[id] || id === this.stationId) return;
    if (transition === 'crossfade' && this.stationId) this.snapshot();
    this.stationId = id;
    const w = this.buildWorld(id);
    this.camera.position.set(...w.def.camera.position);
    this.controls.target.copy(w.target);
    this.controls.minDistance = w.def.orbit.minDistance;
    this.controls.maxDistance = w.def.orbit.maxDistance;
    this.controls.update();
    this.hovered = null;
    this.applyZones();
    this.lastSunCalc = -Infinity;
    this.fit();
    this.container.dataset.station = id;
    this.request();
    if (transition === 'crossfade') this.fadeOut(200);
    // Build the other station while idle, so the next switch has no hitch.
    const other = Object.keys(STATION_DEFS).find((s) => s !== id && !this.worlds[s]);
    if (other) (window.requestIdleCallback || ((f) => setTimeout(f, 400)))(() => { if (!this.disposed) this.buildWorld(other); });
  }

  /** Copy the current frame to the fade canvas (drawn in the same task as a render). */
  snapshot() {
    if (!this.world) return;
    this.renderFrame();
    const c = this.fadeCanvas;
    c.width = this.renderer.domElement.width; c.height = this.renderer.domElement.height;
    c.getContext('2d').drawImage(this.renderer.domElement, 0, 0);
    c.style.transition = 'none';
    c.style.opacity = '1';
  }

  fadeOut(ms) {
    const c = this.fadeCanvas;
    requestAnimationFrame(() => {
      c.style.transition = `opacity ${ms}ms cubic-bezier(0.2, 0, 0, 1)`;
      c.style.opacity = '0';
    });
  }

  // ── State from props ──────────────────────────────────────

  setAlerts(alerts) { this.alerts = alerts || {}; this.applyZones(); }
  setSelected(id) { this.selected = id || null; this.applyZones(); }

  setHover(id) {
    if (id === this.hovered) return;
    this.hovered = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : 'default';
    this.applyZones();
    this.cb.onHover?.(id);
  }

  applyZones() {
    const w = this.world;
    if (!w) return;
    w.zones.forEach((z) => styleZone(z, { level: levelOf(this.alerts, z.id), selected: this.selected === z.id, hovered: this.hovered === z.id }, this.colours));
    this.request();
  }

  setEnvironment(env) {
    this.env = { ...this.env, ...env, ...this.debugEnv };
    this.lastSunCalc = -Infinity;
    this.request();
  }

  /** Development only (screenshots): pin the replay time / wind regardless of telemetry. */
  setDebugEnvironment(env) {
    this.debugEnv = env || null;
    this.setEnvironment({});
  }

  setAvoidBottom(px) {
    this.avoidBottom = px || 0;
    this.fit();
  }

  // ── Framing: keep the station clear of the HUD card band ──

  /** Projected box of the station's zones for a camera, in container px. */
  modelBox(camera, w, h) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const box = new THREE.Box3(); const v = new THREE.Vector3();
    this.world?.zones.forEach((z) => {
      z.shell.updateMatrixWorld();
      box.setFromObject(z.shell);
      for (let i = 0; i < 8; i += 1) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
        if (v.z > 1) continue;
        const sx = ((v.x + 1) / 2) * w; const sy = ((1 - v.y) / 2) * h;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
    });
    return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
  }

  fit() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h || !this.world) return;
    const cam = this.camera;
    cam.aspect = w / h;
    cam.zoom = 1;
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const band = this.avoidBottom;
    if (band > 0) {
      // Measure at the default pose: the station's lowest point and the horizon, as fractions
      // of the height from the centre; then the largest zoom (≤ 1) and smallest lens shift
      // that keep the station above the band and some horizon visible (as in 1B).
      const probe = cam.clone();
      probe.position.set(...this.world.def.camera.position);
      probe.lookAt(this.world.target);
      probe.updateMatrixWorld(); probe.updateProjectionMatrix();
      const mb = this.modelBox(probe, w, h);
      const fwd = new THREE.Vector3(); probe.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      const hz = probe.position.clone().addScaledVector(fwd, 6000); hz.y = 0;
      const hv = hz.project(probe);
      const bottom = mb ? mb[3] / h - 0.5 : 0.2;
      const horizon = (1 - hv.y) / 2 - 0.5;
      const free = h - band - 24;
      const z = Math.max(0.55, Math.min(1, (free - HORIZON_MIN * h) / Math.max(1e-3, (bottom - horizon) * h)));
      cam.zoom = z;
      const shift = Math.max(0, h / 2 + z * bottom * h - free);
      cam.setViewOffset(w, h, 0, shift, w, h);
      cam.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
    this.request();
  }

  // ── Picking ───────────────────────────────────────────────

  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const shells = this.world?.zones.map((z) => z.shell) || [];
    const hit = this.raycaster.intersectObjects(shells, false)[0];
    return hit?.object.userData.buildingId || null;
  }

  onPointerMove(e) {
    if (this.down && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 4) return;
    this.setHover(this.pick(e));
  }

  onPointerDown(e) { this.down = [e.clientX, e.clientY]; }

  onPointerUp(e) {
    const d = this.down; this.down = null;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return;
    this.cb.onPick?.(this.pick(e));
  }

  onVisibility() { if (!document.hidden) this.request(); }

  onContextLost(e) {
    e.preventDefault();
    this.cb.onFatal?.(new Error('WebGL context lost'));
  }

  // ── Loop ──────────────────────────────────────────────────

  request() {
    this.needsFrame = true;
    if (!this.running && !this.disposed) { this.running = true; this.last = performance.now(); requestAnimationFrame(this.loop); }
  }

  /** Something keeps changing on screen, so keep drawing (never under reduced motion). */
  animating() {
    if (this.reducedMotion || !this.world) return false;
    return true;   // decorative snowfall and/or blowing snow are always moving
  }

  updateEnvironment(now, dt) {
    const w = this.world;
    const target = driftIntensity(this.env.windKmh);
    this.drift = smoothToward(this.drift, target, dt, this.reducedMotion ? 0.01 : 6);
    const fromDeg = Number.isFinite(this.env.windFromDeg) ? this.env.windFromDeg : (this.prevailingWind[this.stationId] ?? 90);
    const toward = ((fromDeg + 180) * Math.PI) / 180;
    const dx = Math.sin(toward); const dz = -Math.cos(toward);
    w.drift.setDirection(dx, dz);
    w.drift.setIntensity(this.drift);
    w.snowfall.setWind(dx, dz, this.drift);
    if (now - this.lastSunCalc > 1000) {
      this.lastSunCalc = now;
      const ms = Number.isFinite(this.env.replayMs) ? this.env.replayMs : Date.now();
      const [lat, lon] = this.coords[this.stationId] || [-70, 0];
      this.sun = solarPosition(ms, lat, lon);
    }
    const a = w.atmos.update(this.sun, this.drift, w.target);
    this.renderer.toneMappingExposure = a.exposure;
    const u = w.terrainMat.userData.uniforms;
    u.uSunView.value.copy(a.sunDir).transformDirection(this.camera.matrixWorldInverse);
    u.uSun.value = Math.min(1, a.sunIntensity);
  }

  renderFrame() {
    const w = this.world;
    if (!w) return;
    w.atmos.sky.position.copy(this.camera.position);
    w.atmos.sky.scale.setScalar(9000);
    this.camera.updateMatrixWorld();
    this.renderer.render(w.scene, this.camera);
  }

  loop(now) {
    if (this.disposed) return;
    if (!this.world) { this.running = false; return; }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    if (!this.visible || document.hidden) { this.running = false; return; }
    const moved = this.controls.update();
    const anim = this.animating();
    // When only the snow moves, 30 fps is plenty: skip alternate frames.
    const minInterval = moved || this.needsFrame ? 0 : 30;
    if (now - this.last >= minInterval) {
      this.time += this.reducedMotion ? 0 : dt;
      this.last = now;
      this.updateEnvironment(now, dt);
      this.world.drift.setTime(this.time);
      this.world.snowfall.setTime(this.time);
      const t0 = performance.now();
      this.renderFrame();
      this.trackPerformance(performance.now() - t0, dt);
      this.needsFrame = false;
      if (this.hovered) this.cb.onHoverMove?.(this.screenPoint(this.world.zones.find((z) => z.id === this.hovered)?.center));
      if ((this.frameNo = (this.frameNo || 0) + 1) % 20 === 0) this.publishModelBox();
    }
    if (moved || anim || this.needsFrame) requestAnimationFrame(this.loop);
    else { this.running = false; this.publishModelBox(); }
  }

  /** Downgrade to the low tier if frames are slow (after a short warm-up). */
  trackPerformance(cpuMs, dt) {
    if (this.tierName === 'low' || this.reducedMotion) return;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length < 90) return;
    const recent = this.frameTimes.slice(-60);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (this.frameTimes.length > 200) this.frameTimes = [];
    if (avg > 40) this.setTier('low');
  }

  setTier(name) {
    if (name === this.tierName) return;
    this.tierName = name; this.tier = TIER[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.dpr));
    Object.values(this.worlds).forEach((w) => {
      w.drift.setCount(this.tier.drift);
      w.snowfall.setCount(this.tier.snow);
      w.snowfall.setPixelRatio(this.renderer.getPixelRatio());
      w.atmos.sun.shadow.mapSize.set(this.tier.shadow, this.tier.shadow);
      w.atmos.sun.shadow.map?.dispose();
      w.atmos.sun.shadow.map = null;
    });
    this.container.dataset.quality = name;
    this.fit();
  }

  screenPoint(v) {
    if (!v) return null;
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    return [((p.x + 1) / 2) * this.container.clientWidth, ((1 - p.y) / 2) * this.container.clientHeight];
  }

  publishModelBox() {
    const { clientWidth: w, clientHeight: h } = this.container;
    const b = this.modelBox(this.camera, w, h);
    if (b) this.container.dataset.modelBox = b.map(Math.round).join(',');
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.io?.disconnect();
    this.controls.dispose();
    Object.values(this.worlds).forEach((w) => {
      w.scene.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m) { m.map?.dispose?.(); m.dispose?.(); } });
      });
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.fadeCanvas.remove();
  }
}
