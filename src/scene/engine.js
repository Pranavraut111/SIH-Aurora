/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — scene engine (three r128). Owns the renderer, the cameras
   and orbit controls, the station worlds, the Antarctica view, picking,
   the render loop and the station-switch transitions (fly-over or
   crossfade). React (StationScene3D.jsx) only feeds it props.

   Render loop: frames are drawn on demand. Something that changes over
   time (blowing snow, decorative snowfall, camera damping, a transition)
   requests frames; with nothing moving, no frames are drawn. The loop
   stops while the tab is hidden or the canvas is off-screen.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { solarPosition } from '../lib/solar';
import { ACCENT_HEX, STATUS_HEX, TIER, driftIntensity, levelOf, nightFactor, phaseOf, smoothToward } from './bindings';
import { buildTerrain } from './terrain';
import { createAtmosphere } from './atmosphere';
import { createDrift, createSnowfall } from './snow';
import { statusColours, styleZone } from './builders';
import { buildContinent } from './continent';
import { arcPoint, ease, easeIn, easeInOut, flightPlan, phaseAt } from './flyover';
import { bharati } from './stations/bharati';
import { maitri } from './stations/maitri';

export const STATION_DEFS = { bharati, maitri };

const HORIZON_MIN = 0.1;   // keep the horizon at least 10 % below the top edge when fitting
const SWAP_FADE_MS = 350;  // crossfade between the station and continent scenes inside a flight

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
    this.continent = null;
    this.view = 'station';
    this.flight = null;
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
    renderer.domElement.dataset.testid = 'scene-canvas';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    // Crossfade layer: a 2D snapshot of the last frame that fades out over the new one.
    const fade = document.createElement('canvas');
    fade.setAttribute('aria-hidden', 'true');
    Object.assign(fade.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', opacity: '0' });
    container.appendChild(fade);
    this.fadeCanvas = fade;

    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);       // station scenes (metres)
    this.ccam = new THREE.PerspectiveCamera(34, 1, 5, 20000);         // continent
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
    this.onWheel = this.onWheel.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    this.onContextLost = this.onContextLost.bind(this);
    this.loop = this.loop.bind(this);
    const el = renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: true });
    el.addEventListener('pointerleave', () => this.setHover(null));
    el.addEventListener('webglcontextlost', this.onContextLost);
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
    const { zones, night } = def.build(site);
    scene.add(site);
    zones.forEach((z) => { scene.add(z.shell); scene.add(z.ring); });
    const target = new THREE.Vector3(...def.camera.target);
    const atmos = createAtmosphere(scene, { shadowSize: this.tier.shadow, shadowExtent: 150 });
    const drift = createDrift({ heightAt: def.terrain.height, center: target, count: TIER.high.drift });
    drift.setCount(this.tier.drift);
    scene.add(drift.mesh);
    const snowfall = createSnowfall({ center: new THREE.Vector3(target.x, target.y - 8, target.z), count: TIER.high.snow });
    snowfall.setCount(this.tier.snow);
    snowfall.setPixelRatio(this.renderer.getPixelRatio());
    scene.add(snowfall.mesh);
    const world = {
      id, def, scene, zones, night, terrainMat, atmos, drift, snowfall, target,
      home: { position: new THREE.Vector3(...def.camera.position), target: target.clone() },
    };
    this.worlds[id] = world;
    return world;
  }

  buildContinent() {
    if (!this.continent) {
      this.continent = buildContinent({ coords: this.coords });
      this.continent.setSelected(this.stationId);
    }
    return this.continent;
  }

  get world() { return this.worlds[this.stationId]; }

  /** Show a station. `transition`: 'none' | 'crossfade' | 'flyover'. */
  setStation(id, { transition = 'none' } = {}) {
    if (!STATION_DEFS[id] || id === this.stationId) return;
    const from = this.stationId;
    this.finishFlight(false);
    if (transition === 'flyover' && from) { this.startFlight(from, id); return; }
    if (transition === 'crossfade' && from) this.snapshot();
    this.stationId = id;
    this.buildWorld(id);
    this.continent?.setSelected(id);
    if (this.view === 'antarctica') this.useView('antarctica');
    else this.goHome();
    this.afterStationChange();
    if (transition === 'crossfade' && from) { this.container.dataset.transition = 'crossfade'; this.fadeOut(200); }
  }

  afterStationChange() {
    this.hovered = null;
    this.applyZones();
    this.lastSunCalc = -Infinity;
    this.container.dataset.station = this.stationId;
    this.request();
    // Build the other station (and the continent) while idle, so the next switch has no hitch.
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 400));
    idle(() => {
      if (this.disposed) return;
      const other = Object.keys(STATION_DEFS).find((s) => !this.worlds[s]);
      if (other) this.buildWorld(other);
      if (!this.reducedMotion) this.buildContinent();
    });
  }

  /** Station camera to the station's default pose. */
  goHome() {
    const w = this.world;
    this.useView('station');
    this.camera.position.copy(w.home.position);
    this.controls.target.copy(w.home.target);
    this.controls.update();
    this.fit();
  }

  /** Switch which scene and camera the controls drive. */
  useView(view) {
    this.view = view;
    this.container.dataset.view = view;
    if (view === 'station') {
      const w = this.world;
      this.controls.object = this.camera;
      this.controls.minDistance = w.def.orbit.minDistance;
      this.controls.maxDistance = w.def.orbit.maxDistance;
      this.controls.maxPolarAngle = Math.PI / 2.08;
    } else {
      const c = this.buildContinent();
      this.controls.object = this.ccam;
      this.ccam.position.copy(c.overview.position);
      this.controls.target.copy(c.overview.target);
      this.controls.minDistance = 300;
      this.controls.maxDistance = 2600;
      this.controls.maxPolarAngle = Math.PI / 2.6;
      this.controls.update();
    }
    this.setHover(null);
    this.cb.onView?.(view);
    this.fit();
  }

  /** Station ↔ Antarctica view, with a 200 ms crossfade (no camera flight). */
  setView(view) {
    if (view === this.view && !this.flight) return;
    this.finishFlight(false);
    this.snapshot();
    if (view === 'station') this.goHome(); else this.useView('antarctica');
    this.container.dataset.transition = 'crossfade';
    this.fadeOut(200);
    this.request();
  }

  // ── Fly-over ──────────────────────────────────────────────

  startFlight(from, to) {
    const c = this.buildContinent();
    this.buildWorld(to);
    const plan = flightPlan(this.view);
    const start = {
      position: (this.view === 'station' ? this.camera : this.ccam).position.clone(),
      target: this.controls.target.clone(),
    };
    const fromWorld = this.worlds[from];
    const away = start.position.clone().sub(fromWorld.target).setY(0).normalize();
    this.flight = {
      from, to, plan, t0: performance.now(), start,
      riseEnd: { position: fromWorld.target.clone().addScaledVector(away, 520).add(new THREE.Vector3(0, 420, 0)), target: fromWorld.target.clone() },
      overA: c.poseOver(from), overB: c.poseOver(to),
      phase: null,
    };
    this.controls.enabled = false;
    this.container.dataset.transition = 'flyover';
    this.container.dataset.flying = 'true';
    this.cb.onFlight?.({ to, flying: true });
    this.request();
  }

  advanceFlight(now) {
    const f = this.flight;
    const at = phaseAt(f.plan, (now - f.t0) / 1000);
    if (!at) { this.finishFlight(true); return; }
    if (at.phase !== f.phase) this.enterPhase(at.phase);
    const lerpPose = (cam, a, b, t) => {
      cam.position.lerpVectors(a.position, b.position, t);
      this.controls.target.lerpVectors(a.target, b.target, t);
      cam.lookAt(this.controls.target);
    };
    if (at.phase === 'rise') lerpPose(this.camera, f.start, f.riseEnd, easeIn(at.u));
    else if (at.phase === 'glide') {
      const t = easeInOut(at.u);
      const a = f.glideFrom; const b = f.overB;
      const p = arcPoint(a.position.toArray(), b.position.toArray(), t, 420);
      this.ccam.position.set(...p);
      this.controls.target.lerpVectors(a.target, b.target, t);
      this.ccam.lookAt(this.controls.target);
    } else if (at.phase === 'descend') lerpPose(this.camera, f.descendFrom, this.worlds[f.to].home, ease(at.u));
  }

  enterPhase(phase) {
    const f = this.flight;
    f.phase = phase;
    if (phase === 'glide') {
      // Up through the haze into the continent view, low over the departing station.
      this.snapshot();
      f.glideFrom = this.view === 'antarctica' ? { position: this.ccam.position.clone(), target: this.controls.target.clone() } : f.overA;
      this.view = 'antarctica';
      this.container.dataset.view = 'antarctica';
      this.ccam.position.copy(f.glideFrom.position);
      this.ccam.lookAt(f.glideFrom.target);
      this.continent.setSelected(f.to);
      this.fitCamera(this.ccam, 'antarctica');
      this.fadeOut(SWAP_FADE_MS);
    } else if (phase === 'descend') {
      this.snapshot();
      this.stationId = f.to;
      const w = this.world;
      const away = w.home.position.clone().sub(w.target).setY(0).normalize();
      f.descendFrom = { position: w.target.clone().addScaledVector(away, 520).add(new THREE.Vector3(0, 420, 0)), target: w.target.clone() };
      this.view = 'station';
      this.container.dataset.view = 'station';
      this.container.dataset.station = f.to;
      this.applyZones();
      this.lastSunCalc = -Infinity;
      this.fitCamera(this.camera, 'station');
      this.fadeOut(SWAP_FADE_MS);
    }
  }

  /** End the flight. `completed` false = cancelled or superseded: jump to the destination. */
  finishFlight(completed) {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    this.controls.enabled = true;
    this.stationId = f.to;
    this.continent?.setSelected(f.to);
    this.goHome();
    if (!completed) { this.fadeCanvas.style.transition = 'none'; this.fadeCanvas.style.opacity = '0'; }
    delete this.container.dataset.flying;
    this.cb.onFlight?.({ to: f.to, flying: false });
    this.afterStationChange();
  }

  cancelFlight() { if (this.flight) this.finishFlight(false); }

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
    requestAnimationFrame(() => requestAnimationFrame(() => {
      c.style.transition = `opacity ${ms}ms cubic-bezier(0.2, 0, 0, 1)`;
      c.style.opacity = '0';
    }));
  }

  // ── State from props ──────────────────────────────────────

  setAlerts(alerts) { this.alerts = alerts || {}; this.applyZones(); }
  setSelected(id) { this.selected = id || null; this.applyZones(); }

  setHover(id) {
    if (id === this.hovered) return;
    this.hovered = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : 'default';
    this.applyZones();
    this.cb.onHover?.(this.view === 'station' ? id : null);
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

  // ── Framing: keep the model clear of the HUD card band ────

  /** World points whose projection must stay above the HUD band, per view. */
  fitPoints(view) {
    if (view === 'antarctica') return this.continent?.fitPoints || [];
    const pts = [];
    const box = new THREE.Box3();
    this.world?.zones.forEach((z) => {
      z.shell.updateMatrixWorld();
      box.setFromObject(z.shell);
      for (let i = 0; i < 8; i += 1) pts.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    });
    return pts;
  }

  /** Projected box of the model's points for a camera, in container px. */
  modelBox(camera, view, w, h) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const v = new THREE.Vector3();
    this.fitPoints(view).forEach((p) => {
      v.copy(p).project(camera);
      if (v.z > 1) return;
      const sx = ((v.x + 1) / 2) * w; const sy = ((1 - v.y) / 2) * h;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    });
    return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
  }

  fit() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h || !this.world) return;
    this.fitCamera(this.camera, 'station');
    if (this.continent) this.fitCamera(this.ccam, 'antarctica');
    this.renderer.setSize(w, h);
    this.request();
  }

  /**
   * Measured at the view's default pose: the model's lowest point and the horizon, as
   * fractions of the height from the centre; then the largest zoom (≤ 1) and smallest lens
   * shift that keep the model above the band and some horizon visible (as in 1B).
   */
  fitCamera(cam, view) {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    cam.aspect = w / h;
    cam.zoom = 1;
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const band = this.avoidBottom;
    if (band <= 0) return;
    const pose = view === 'station' ? this.world.home : this.continent?.overview;
    if (!pose) return;
    const probe = cam.clone();
    probe.position.copy(pose.position);
    probe.lookAt(pose.target);
    probe.updateMatrixWorld(); probe.updateProjectionMatrix();
    const mb = this.modelBox(probe, view, w, h);
    const fwd = new THREE.Vector3(); probe.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const hz = probe.position.clone().addScaledVector(fwd, view === 'station' ? 6000 : 15000); hz.y = 0;
    const hv = hz.project(probe);
    const bottom = mb ? mb[3] / h - 0.5 : 0.2;
    const horizon = view === 'station' ? (1 - hv.y) / 2 - 0.5 : (mb ? mb[1] / h - 0.5 : -0.4);
    const free = h - band - 24;
    const z = Math.max(0.5, Math.min(1, (free - HORIZON_MIN * h) / Math.max(1e-3, (bottom - horizon) * h)));
    cam.zoom = z;
    const shift = Math.max(0, h / 2 + z * bottom * h - free);
    cam.setViewOffset(w, h, 0, shift, w, h);
    cam.updateProjectionMatrix();
  }

  // ── Picking ───────────────────────────────────────────────

  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (this.view === 'antarctica') {
      this.raycaster.setFromCamera(this.pointer, this.ccam);
      const hit = this.raycaster.intersectObjects(this.continent?.hitTargets || [], false)[0];
      return hit ? { station: hit.object.userData.stationId } : null;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const shells = this.world?.zones.map((z) => z.shell) || [];
    const hit = this.raycaster.intersectObjects(shells, false)[0];
    return hit ? { building: hit.object.userData.buildingId } : null;
  }

  onPointerMove(e) {
    if (this.flight) return;
    if (this.down && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 4) return;
    const hit = this.pick(e);
    if (this.view === 'antarctica') {
      this.renderer.domElement.style.cursor = hit?.station ? 'pointer' : 'default';
      return;
    }
    this.setHover(hit?.building || null);
  }

  onPointerDown(e) {
    if (this.flight) { this.cancelFlight(); return; }
    this.down = [e.clientX, e.clientY];
  }

  onWheel() { if (this.flight) this.cancelFlight(); }

  onPointerUp(e) {
    const d = this.down; this.down = null;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return;
    const hit = this.pick(e);
    if (this.view === 'antarctica') {
      if (hit?.station) this.cb.onStationPick?.(hit.station);
      return;
    }
    this.cb.onPick?.(hit?.building || null);
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

  /** Something keeps changing on screen, so keep drawing (snow; never under reduced motion). */
  animating() {
    if (this.flight) return true;
    return !this.reducedMotion && this.view === 'station';
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
      const night = nightFactor(this.sun.elevation);
      w.night.forEach(({ mat, color, intensity }) => { mat.emissive.copy(color); mat.emissiveIntensity = intensity * night; });
      this.container.dataset.daylight = phaseOf(this.sun.elevation);
    }
    const a = w.atmos.update(this.sun, this.drift, w.target, this.camera.position);
    this.renderer.toneMappingExposure = a.exposure;
    const u = w.terrainMat.userData.uniforms;
    u.uSunView.value.copy(a.sunDir).transformDirection(this.camera.matrixWorldInverse);
    u.uSun.value = Math.min(1, a.sunIntensity);
  }

  renderFrame() {
    if (this.view === 'antarctica' && this.continent) {
      this.ccam.updateMatrixWorld();
      this.renderer.toneMappingExposure = 1;
      this.renderer.render(this.continent.scene, this.ccam);
      return;
    }
    const w = this.world;
    if (!w) return;
    w.atmos.sky.position.copy(this.camera.position);
    w.atmos.sky.scale.setScalar(9000);
    w.atmos.stars.position.copy(this.camera.position);
    w.atmos.stars.scale.setScalar(8000);
    this.camera.updateMatrixWorld();
    this.renderer.render(w.scene, this.camera);
  }

  loop(now) {
    if (this.disposed) return;
    if (!this.world) { this.running = false; return; }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    if (!this.visible || document.hidden) { this.running = false; return; }
    if (this.flight) this.advanceFlight(now);
    const moved = this.flight ? true : this.controls.update();
    // When only the snow moves, 30 fps is plenty: skip alternate frames.
    const minInterval = moved || this.needsFrame ? 0 : 30;
    if (now - this.last >= minInterval) {
      this.time += this.reducedMotion ? 0 : dt;
      this.last = now;
      if (this.view === 'station') {
        this.updateEnvironment(now, dt);
        this.world.drift.setTime(this.time);
        this.world.snowfall.setTime(this.time);
      }
      this.renderFrame();
      this.trackPerformance(dt);
      this.needsFrame = false;
      if (this.view === 'station' && this.hovered) this.cb.onHoverMove?.(this.screenPoint(this.world.zones.find((z) => z.id === this.hovered)?.center, this.camera));
      if (this.view === 'antarctica' && this.continent) this.publishPins();
      if ((this.frameNo = (this.frameNo || 0) + 1) % 20 === 0) this.publishModelBox();
    }
    if (moved || this.animating() || this.needsFrame) requestAnimationFrame(this.loop);
    else { this.running = false; this.publishModelBox(); if (this.view === 'antarctica') this.publishPins(); }
  }

  publishPins() {
    const out = {};
    const w = this.container.clientWidth;
    Object.entries(this.continent.pins).forEach(([id, p]) => {
      const pt = this.screenPoint(p.head, this.ccam);
      // Keep the DOM label inside the scene (labels are centred on x).
      out[id] = pt && [Math.min(Math.max(pt[0], 80), w - 80), pt[1]];
    });
    this.cb.onPins?.(out);
  }

  /** Downgrade to the low tier if frames are slow (after a short warm-up). */
  trackPerformance(dt) {
    if (this.tierName === 'low' || this.reducedMotion || this.flight) return;
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
    this.cb.onTier?.(name);
    this.fit();
  }

  screenPoint(v, cam) {
    if (!v) return null;
    const p = v.clone().project(cam);
    if (p.z > 1) return null;
    return [((p.x + 1) / 2) * this.container.clientWidth, ((1 - p.y) / 2) * this.container.clientHeight];
  }

  publishModelBox() {
    const { clientWidth: w, clientHeight: h } = this.container;
    const b = this.modelBox(this.view === 'station' ? this.camera : this.ccam, this.view, w, h);
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
    this.continent?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.fadeCanvas.remove();
  }
}
