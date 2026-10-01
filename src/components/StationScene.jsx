/* ═══════════════════════════════════════════════════════════════
   Aurora — 3D Antarctic Station Scene (Three.js r128)
   Full-screen Antarctic polar environment: Expansive undulating ice sheet,
   panoramic mountain ranges, full-sky snow particle field, aurora borealis,
   and interactive low-poly research station.
   ═══════════════════════════════════════════════════════════════ */
import { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BUILDINGS } from '../data/stationData';
import StationFallback2D from './StationFallback2D';

// ── Color mapping for alert states ──────────────────────────
const ALERT_COLORS = {
  normal:  new THREE.Color(0x4ade80),  // green
  warning: new THREE.Color(0xfbbf24),  // amber
  critical: new THREE.Color(0xf87171), // red
};

const BASE_BUILDING_COLOR = new THREE.Color(0x2a3648);
const SELECTED_GLOW = new THREE.Color(0x38bdf8);

/** True when the browser can create a WebGL context (probe on a throwaway canvas). */
function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch (err) {
    console.warn('[StationScene] WebGL probe failed', err);
    return false;
  }
}

/**
 * Overview scene: three.js 3D twin when WebGL works, otherwise (no WebGL, or
 * the renderer throws) a 2D overview with the same buildings and click behaviour.
 */
export default function StationScene(props) {
  const [mode, setMode] = useState(() => (hasWebGL() ? '3d' : '2d'));
  const [reason, setReason] = useState(() => (mode === '3d' ? null : 'WebGL is not available in this browser'));
  const handleFatal = useCallback((err) => {
    setReason(`3D renderer failed: ${err?.message || err}`);
    setMode('2d');
  }, []);
  if (mode === '2d') return <StationFallback2D {...props} reason={reason} />;
  return <StationScene3D {...props} onFatal={handleFatal} />;
}

function StationScene3D({
  alertStates = {},
  selectedBuilding,
  onBuildingClick,
  onBuildingHover,
  onFatal,
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const buildingMeshes = useRef({});
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const animationRef = useRef(null);
  const hoveredRef = useRef(null);
  const snowParticlesRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());

  // ── Create scene ────────────────────────────────────────────
  const initScene = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous canvases if any
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Scene
    const scene = new THREE.Scene();
    // Deep polar night sky color with subtle atmospheric fog
    const skyColor = new THREE.Color(0x060911);
    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(0x0a101d, 0.005);
    sceneRef.current = scene;

    // Camera
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.5, 1200);
    camera.position.set(28, 22, 34);
    camera.lookAt(0, 2, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls (OrbitControls)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 12;
    controls.maxDistance = 120;
    controls.maxPolarAngle = Math.PI / 2.05; // allow looking horizontally across ice
    controls.target.set(0, 1.5, 0);
    controlsRef.current = controls;

    // ── Lighting ──────────────────────────────────────────────
    // Ambient light with soft blue polar tint
    const ambient = new THREE.AmbientLight(0x5a7ca8, 0.65);
    scene.add(ambient);

    // Directional "sun/moon" light — low cold angle
    const sun = new THREE.DirectionalLight(0xddeeff, 1.3);
    sun.position.set(35, 25, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    scene.add(sun);

    // Fill light from horizon
    const fill = new THREE.DirectionalLight(0x446699, 0.45);
    fill.position.set(-30, 15, -30);
    scene.add(fill);

    // Hemisphere light for realistic sky/ice gradient
    const hemi = new THREE.HemisphereLight(0x7aa0d6, 0x182436, 0.5);
    scene.add(hemi);

    // ── Starry Sky Background Field ───────────────────────────
    createStarrySky(scene);

    // ── Expansive Polar Ground Sheet (600x600) ────────────────
    const groundGeo = new THREE.PlaneGeometry(600, 600, 80, 80);
    const posAttr = groundGeo.getAttribute('position');
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      // Gentle undulating sastrugi snow drifts
      const noise =
        Math.sin(x * 0.04) * Math.cos(y * 0.03) * 1.2 +
        Math.sin(x * 0.08 + y * 0.06) * 0.6 +
        Math.cos(x * 0.02 - y * 0.02) * 1.5;
      posAttr.setZ(i, noise);
    }
    groundGeo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xc8dce8,
      roughness: 0.8,
      metalness: 0.08,
      flatShading: true,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.15;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── Panoramic Mountain Ridges ─────────────────────────────
    createPanoramicMountains(scene);

    // ── Station Buildings ─────────────────────────────────────
    Object.entries(BUILDINGS).forEach(([id, bldg]) => {
      const mesh = createBuilding(id, bldg, scene);
      buildingMeshes.current[id] = mesh;
    });

    // ── Station Details (Antenna cables, fuel drums, flag) ─────
    createStationDetails(scene);

    // ── Full-Viewport Snow Particle Field ─────────────────────
    snowParticlesRef.current = createSnowParticles(scene);

    // ── Aurora Australis Waves ────────────────────────────────
    createAuroraEffect(scene);
  }, []);

  // ── Starfield Dome ──────────────────────────────────────────
  function createStarrySky(scene) {
    const starCount = 1200;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 280 + Math.random() * 50;

      starPositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 10; // above horizon
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xe2e8f0,
      size: 0.8,
      transparent: true,
      opacity: 0.85,
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);
  }

  // ── Single Building Construction ────────────────────────────
  function createBuilding(id, bldg, scene) {
    const group = new THREE.Group();
    group.userData = { buildingId: id, isBuilding: true };
    const [w, h, d] = bldg.size;
    const [px, py, pz] = bldg.position;

    // Main structural block
    const bodyGeo = new THREE.BoxGeometry(w, h, d);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: BASE_BUILDING_COLOR,
      roughness: 0.65,
      metalness: 0.25,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData = { buildingId: id, isBuilding: true };
    group.add(body);

    // Structure specifics
    if (id === 'waterTank') {
      const tankGeo = new THREE.CylinderGeometry(w * 0.45, w * 0.5, h, 16);
      const tankMat = new THREE.MeshStandardMaterial({
        color: 0x334458,
        roughness: 0.5,
        metalness: 0.4,
      });
      body.geometry = tankGeo;
      body.material = tankMat;
    } else if (id === 'commsMast') {
      body.geometry = new THREE.BoxGeometry(1.4, h, 1.4);
      body.position.y = h / 2;

      // Antenna dish
      const dishGeo = new THREE.CircleGeometry(1.4, 20);
      const dishMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.2, side: THREE.DoubleSide });
      const dish = new THREE.Mesh(dishGeo, dishMat);
      dish.position.set(1.4, h * 0.8, 0);
      dish.rotation.y = Math.PI / 3.5;
      dish.userData = { buildingId: id, isBuilding: true };
      group.add(dish);

      // Blinking beacon light
      const lightGeo = new THREE.SphereGeometry(0.3, 12, 12);
      const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
      const blinkLight = new THREE.Mesh(lightGeo, lightMat);
      blinkLight.position.y = h + 0.4;
      blinkLight.userData = { isBlinker: true };
      group.add(blinkLight);
    } else {
      // Slanted roof for polar snow shedding
      const roofShape = new THREE.Shape();
      const roofW = w * 0.54;
      const roofH = h * 0.35;
      roofShape.moveTo(-roofW, 0);
      roofShape.lineTo(0, roofH);
      roofShape.lineTo(roofW, 0);
      roofShape.lineTo(-roofW, 0);

      const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.4, bevelEnabled: false });
      const roofMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.5,
        metalness: 0.35,
      });
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.set(0, h, -d / 2 - 0.2);
      roof.castShadow = true;
      roof.userData = { buildingId: id, isBuilding: true };
      group.add(roof);
    }

    // Illuminated observation windows
    if (id !== 'commsMast' && id !== 'waterTank') {
      const windowCount = Math.max(Math.floor(w / 2), 2);
      for (let i = 0; i < windowCount; i++) {
        const winGeo = new THREE.PlaneGeometry(0.65, 0.45);
        const winMat = new THREE.MeshBasicMaterial({
          color: 0xfef08a,
          transparent: true,
          opacity: 0.85,
        });
        const win = new THREE.Mesh(winGeo, winMat);
        win.position.set(
          -w / 2 + 1.2 + i * (w - 2.4) / Math.max(windowCount - 1, 1),
          h * 0.55,
          d / 2 + 0.02
        );
        win.userData = { buildingId: id, isBuilding: true };
        group.add(win);
      }
    }

    // Status indicator beacon
    const indicatorGeo = new THREE.SphereGeometry(0.3, 12, 12);
    const indicatorMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
    const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
    indicator.position.y = id === 'commsMast' ? h + 1.2 : h + h * 0.35 + 0.6;
    indicator.userData = { isIndicator: true, buildingId: id };
    group.add(indicator);

    group.position.set(px, py, pz);
    scene.add(group);

    return { group, body, indicator, bodyMat: body.material };
  }

  // ── Panoramic Mountain Ridges ───────────────────────────────
  function createPanoramicMountains(scene) {
    const mountainMat = new THREE.MeshStandardMaterial({
      color: 0x162032,
      roughness: 0.95,
      metalness: 0.1,
      flatShading: true,
    });

    // Outer mountain perimeter surrounding the station
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const dist = 90 + Math.random() * 40;
      const height = 12 + Math.random() * 20;
      const width = 16 + Math.random() * 24;

      const geo = new THREE.ConeGeometry(width, height, 6 + Math.floor(Math.random() * 3));
      const mesh = new THREE.Mesh(geo, mountainMat.clone());
      mesh.position.set(
        Math.cos(angle) * dist,
        height / 2 - 2,
        Math.sin(angle) * dist
      );
      mesh.rotation.y = Math.random() * Math.PI;
      scene.add(mesh);
    }
  }

  // ── Station Props (Flag, Drums, Vehicles) ───────────────────
  function createStationDetails(scene) {
    // Fuel Depot drums
    for (let i = 0; i < 8; i++) {
      const drumGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.9, 12);
      const drumMat = new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? 0xd93829 : 0x2563eb,
        roughness: 0.5,
        metalness: 0.4,
      });
      const drum = new THREE.Mesh(drumGeo, drumMat);
      drum.position.set(-13 + (i % 4) * 1.0, 0.45, -6 + Math.floor(i / 4) * 1.1);
      drum.castShadow = true;
      scene.add(drum);
    }

    // Snow vehicle / PistenBully
    const vehicleGroup = new THREE.Group();
    const vehicleBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.8, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.4, metalness: 0.3 })
    );
    vehicleBody.position.y = 0.5;
    vehicleBody.castShadow = true;
    vehicleGroup.add(vehicleBody);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.6, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.2, metalness: 0.8 })
    );
    cabin.position.set(0.3, 1.0, 0);
    vehicleGroup.add(cabin);

    vehicleGroup.position.set(5.5, 0, 8.5);
    vehicleGroup.rotation.y = -0.4;
    scene.add(vehicleGroup);

    // Tricolor Indian Flag pole
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 5.5, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.8 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(3, 2.75, 7.5);
    scene.add(pole);

    const flagGeo = new THREE.PlaneGeometry(1.8, 1.1);
    const flagCanvas = document.createElement('canvas');
    flagCanvas.width = 180;
    flagCanvas.height = 110;
    const ctx = flagCanvas.getContext('2d');
    ctx.fillStyle = '#ff9933'; ctx.fillRect(0, 0, 180, 37);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 37, 180, 37);
    ctx.fillStyle = '#138808'; ctx.fillRect(0, 74, 180, 37);
    ctx.strokeStyle = '#000080';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(90, 55, 14, 0, Math.PI * 2);
    ctx.stroke();
    const flagTex = new THREE.CanvasTexture(flagCanvas);
    const flagMat = new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(3.9, 4.8, 7.5);
    scene.add(flag);
  }

  // ── Expansive Snow Particles (240x240 field) ────────────────
  function createSnowParticles(scene) {
    const particleCount = 4500;
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 240;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 240;

      velocities[i * 3]     = (Math.random() - 0.5) * 0.04;
      velocities[i * 3 + 1] = -0.03 - Math.random() * 0.05;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.22,
      transparent: true,
      opacity: 0.75,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const snow = new THREE.Points(geo, mat);
    scene.add(snow);

    return { mesh: snow, velocities, positions };
  }

  // ── Aurora Waves ───────────────────────────────────────────
  function createAuroraEffect(scene) {
    const auroraGeo = new THREE.PlaneGeometry(220, 35, 60, 12);
    const auroraMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor1: { value: new THREE.Color(0x38bdf8) },
        uColor2: { value: new THREE.Color(0xa855f7) },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vDisplacement;
        void main() {
          vUv = uv;
          vec3 pos = position;
          float displacement = sin(pos.x * 0.1 + uTime * 0.4) * cos(pos.x * 0.05 + uTime * 0.2) * 4.0;
          pos.z += displacement;
          vDisplacement = displacement;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        uniform float uTime;
        varying vec2 vUv;
        varying float vDisplacement;
        void main() {
          float alpha = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.4, vUv.y);
          alpha *= 0.25 + 0.08 * sin(vUv.x * 8.0 + uTime * 0.8);
          vec3 color = mix(uColor1, uColor2, vUv.x + vDisplacement * 0.05);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const aurora = new THREE.Mesh(auroraGeo, auroraMat);
    aurora.position.set(0, 35, -90);
    aurora.rotation.x = -0.15;
    aurora.userData = { isAurora: true };
    scene.add(aurora);
  }

  // ── Animation Loop ──────────────────────────────────────────
  const animate = useCallback(() => {
    if (!rendererRef.current) return; // 3D init failed or unmounted — nothing to draw
    animationRef.current = requestAnimationFrame(animate);

    const elapsed = clockRef.current.getElapsedTime();
    controlsRef.current?.update();

    // Snow animation loop
    if (snowParticlesRef.current) {
      const { mesh, velocities } = snowParticlesRef.current;
      const posAttr = mesh.geometry.getAttribute('position');
      for (let i = 0; i < posAttr.count; i++) {
        let x = posAttr.getX(i) + velocities[i * 3] + Math.sin(elapsed + i) * 0.005;
        let y = posAttr.getY(i) + velocities[i * 3 + 1];
        let z = posAttr.getZ(i) + velocities[i * 3 + 2];

        if (y < 0) {
          x = (Math.random() - 0.5) * 240;
          y = 35 + Math.random() * 5;
          z = (Math.random() - 0.5) * 240;
        }

        posAttr.setXYZ(i, x, y, z);
      }
      posAttr.needsUpdate = true;
    }

    // Aurora wave animation
    sceneRef.current?.traverse((obj) => {
      if (obj.userData?.isAurora && obj.material?.uniforms) {
        obj.material.uniforms.uTime.value = elapsed;
      }
      if (obj.userData?.isBlinker) {
        obj.material.opacity = Math.sin(elapsed * 4) > 0 ? 1 : 0.1;
        obj.material.transparent = true;
      }
    });

    // Subsystem alert pulses
    Object.entries(buildingMeshes.current).forEach(([id, { indicator, bodyMat }]) => {
      const alertLevel = alertStates[id] || 'normal';
      const alertColor = ALERT_COLORS[alertLevel];

      if (alertLevel === 'critical') {
        const pulse = (Math.sin(elapsed * 4) + 1) / 2;
        bodyMat.emissive.copy(alertColor);
        bodyMat.emissiveIntensity = 0.25 + pulse * 0.45;
      } else if (alertLevel === 'warning') {
        const pulse = (Math.sin(elapsed * 2.5) + 1) / 2;
        bodyMat.emissive.copy(alertColor);
        bodyMat.emissiveIntensity = 0.15 + pulse * 0.2;
      } else {
        const pulse = (Math.sin(elapsed * 0.8 + id.charCodeAt(0)) + 1) / 2;
        bodyMat.emissive.copy(ALERT_COLORS.normal);
        bodyMat.emissiveIntensity = 0.03 + pulse * 0.04;
      }

      if (selectedBuilding === id) {
        bodyMat.emissive.copy(SELECTED_GLOW);
        bodyMat.emissiveIntensity = 0.35 + ((Math.sin(elapsed * 2) + 1) / 2) * 0.25;
      }

      indicator.material.color.copy(alertColor);
    });

    rendererRef.current?.render(sceneRef.current, cameraRef.current);
  }, [alertStates, selectedBuilding]);

  // ── Mouse & Click Raycasting ────────────────────────────────
  const handleMouseMove = useCallback((event) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    mouse.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.current.setFromCamera(mouse.current, cameraRef.current);
    const intersects = raycaster.current.intersectObjects(sceneRef.current.children, true);

    let foundBuilding = null;
    for (const hit of intersects) {
      const bId = hit.object.userData?.buildingId || hit.object.parent?.userData?.buildingId;
      if (bId && BUILDINGS[bId]) {
        foundBuilding = bId;
        break;
      }
    }

    if (foundBuilding !== hoveredRef.current) {
      if (hoveredRef.current && buildingMeshes.current[hoveredRef.current]) {
        buildingMeshes.current[hoveredRef.current].group.scale.set(1, 1, 1);
      }
      if (foundBuilding && buildingMeshes.current[foundBuilding]) {
        buildingMeshes.current[foundBuilding].group.scale.set(1.04, 1.04, 1.04);
        container.style.cursor = 'pointer';
      } else {
        container.style.cursor = 'default';
      }
      hoveredRef.current = foundBuilding;
      onBuildingHover?.(foundBuilding);
    }
  }, [onBuildingHover]);

  const handleClick = useCallback((event) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    mouse.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.current.setFromCamera(mouse.current, cameraRef.current);
    const intersects = raycaster.current.intersectObjects(sceneRef.current.children, true);

    for (const hit of intersects) {
      const bId = hit.object.userData?.buildingId || hit.object.parent?.userData?.buildingId;
      if (bId && BUILDINGS[bId]) {
        onBuildingClick?.(bId);
        return;
      }
    }
    onBuildingClick?.(null);
  }, [onBuildingClick]);

  // ── Responsive Resize (Window & Container / Sidebar) ────────
  const handleResize = useCallback(() => {
    const container = containerRef.current;
    if (!container || !cameraRef.current || !rendererRef.current) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    cameraRef.current.aspect = width / height;
    cameraRef.current.updateProjectionMatrix();
    rendererRef.current.setSize(width, height);
  }, []);

  useEffect(() => {
    try {
      initScene();
    } catch (err) {
      console.error('[StationScene] 3D init failed — switching to 2D overview', err);
      rendererRef.current = null;
      onFatal?.(err);
      return undefined;
    }

    // ResizeObserver watches container width directly when sidebar expands/collapses
    let resizeObserver = null;
    const container = containerRef.current;
    if (container && typeof window !== 'undefined' && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(container);
    }

    window.addEventListener('resize', handleResize);
    containerRef.current?.addEventListener('mousemove', handleMouseMove);
    containerRef.current?.addEventListener('click', handleClick);

    clockRef.current.start();
    animate();

    return () => {
      if (resizeObserver && container) {
        resizeObserver.unobserve(container);
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', handleResize);
      containerRef.current?.removeEventListener('mousemove', handleMouseMove);
      containerRef.current?.removeEventListener('click', handleClick);

      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      rendererRef.current?.dispose();

      if (container && rendererRef.current?.domElement) {
        container.removeChild(rendererRef.current.domElement);
      }
    };
  }, []);

  useEffect(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animate();
  }, [animate]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
      }}
    />
  );
}
