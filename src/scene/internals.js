/* ═══════════════════════════════════════════════════════════════
   Aurora — 3D Internal Machinery & Subsystem Models.
   Placed physically INSIDE station buildings, visible through
   translucent shells during X-Ray and Systems inspection modes.

   Includes:
     · DG Genset #1 & #2 (engine block, alternator, radiator, exhaust)
     · BESS Battery Bank (modular storage rack with active status LEDs)
     · Day Tank SAB-55 (cylindrical fuel tank with level gauge & piping)
     · Water RO Plant (reverse osmosis membrane vessels & booster pump)
     · Thermal Loop A/B Boilers (calorifier buffer tanks & circulating pumps)
     · Cryo Storage Dewars (liquid nitrogen/helium dewars & lab rack)
     · Satellite Transceiver Terminal (uplink shelter & waveguide)
     · HVAC Life Support Air Handling Unit (centrifugal blower & ducting)
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';

const BLUEPRINT_EDGE = new THREE.Color('#7FDBFF').convertSRGBToLinear();
const DG_ACCENT = new THREE.Color('#00E5FF').convertSRGBToLinear();
const BESS_ACCENT = new THREE.Color('#2ECC71').convertSRGBToLinear();
const FUEL_ACCENT = new THREE.Color('#F5B83D').convertSRGBToLinear();
const HEAT_ACCENT = new THREE.Color('#FF8C42').convertSRGBToLinear();
const WATER_ACCENT = new THREE.Color('#38B6FF').convertSRGBToLinear();
const CRYO_ACCENT = new THREE.Color('#A0E7E5').convertSRGBToLinear();

function makeEdges(geo, color = BLUEPRINT_EDGE, opacity = 0.55) {
  const lineMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
  const segs = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), lineMat);
  segs.renderOrder = 8;
  return segs;
}

export function buildInternals(world) {
  const root = new THREE.Group();
  root.name = 'station-internals';
  root.renderOrder = 7;

  const sharedMats = {
    darkChassis: new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.5,
      metalness: 0.7,
      transparent: true,
      opacity: 0.92,
      depthWrite: true,
    }),
    engineBlock: new THREE.MeshStandardMaterial({
      color: 0x374151,
      roughness: 0.4,
      metalness: 0.8,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    }),
    steel: new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.3,
      metalness: 0.85,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    }),
    pipeAmber: new THREE.MeshStandardMaterial({
      color: 0xf5b83d,
      emissive: FUEL_ACCENT,
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.6,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    }),
    pipeHeat: new THREE.MeshStandardMaterial({
      color: 0xff8c42,
      emissive: HEAT_ACCENT,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.6,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    }),
    pipeWater: new THREE.MeshStandardMaterial({
      color: 0x38b6ff,
      emissive: WATER_ACCENT,
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.6,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    }),
    bessLed: new THREE.MeshBasicMaterial({
      color: BESS_ACCENT,
      toneMapped: false,
    }),
    dgLed: new THREE.MeshBasicMaterial({
      color: DG_ACCENT,
      toneMapped: false,
    }),
    cryoBody: new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      roughness: 0.2,
      metalness: 0.9,
      emissive: CRYO_ACCENT,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    }),
  };

  function addMeshWithEdges(group, geo, mat, edgeColor, edgeOpacity) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 7;
    group.add(mesh);
    group.add(makeEdges(geo, edgeColor, edgeOpacity));
    return mesh;
  }

  // ── DG Genset Builder ─────────────────────────────────────────
  function createGenset(x, y, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;

    // Steel skid foundation
    const skidGeo = new THREE.BoxGeometry(4.2, 0.35, 1.8);
    const skid = addMeshWithEdges(g, skidGeo, sharedMats.darkChassis, BLUEPRINT_EDGE, 0.6);
    skid.position.set(0, 0.175, 0);

    // Engine block
    const blockGeo = new THREE.BoxGeometry(2.1, 1.3, 1.1);
    const block = addMeshWithEdges(g, blockGeo, sharedMats.engineBlock, DG_ACCENT, 0.7);
    block.position.set(-0.7, 0.35 + 0.65, 0);

    // Cylindrical alternator head
    const altGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.4, 16);
    altGeo.rotateZ(Math.PI / 2);
    const alt = addMeshWithEdges(g, altGeo, sharedMats.steel, DG_ACCENT, 0.8);
    alt.position.set(1.0, 0.35 + 0.6, 0);

    // Radiator cooler core
    const radGeo = new THREE.BoxGeometry(0.5, 1.6, 1.4);
    const rad = addMeshWithEdges(g, radGeo, sharedMats.darkChassis, BLUEPRINT_EDGE, 0.5);
    rad.position.set(-1.85, 0.35 + 0.8, 0);

    // Vertical exhaust riser
    const exhGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 12);
    const exh = addMeshWithEdges(g, exhGeo, sharedMats.steel, BLUEPRINT_EDGE, 0.6);
    exh.position.set(-0.6, 0.35 + 1.3 + 1.1, -0.35);

    // Control cabinet & display screen
    const panelGeo = new THREE.BoxGeometry(0.4, 1.1, 0.6);
    const panel = addMeshWithEdges(g, panelGeo, sharedMats.darkChassis, BLUEPRINT_EDGE, 0.5);
    panel.position.set(1.5, 0.35 + 0.9, 0.5);

    const screenGeo = new THREE.PlaneGeometry(0.02, 0.28);
    const screen = new THREE.Mesh(screenGeo, sharedMats.dgLed);
    screen.position.set(1.71, 0.35 + 1.05, 0.5);
    screen.rotation.y = Math.PI / 2;
    g.add(screen);

    return g;
  }

  // ── BESS Battery Storage Substation Rack ───────────────────────
  function createBESSBatteryBank(x, y, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;

    // Rack frame enclosure
    const rackGeo = new THREE.BoxGeometry(2.4, 2.8, 1.2);
    const rack = addMeshWithEdges(g, rackGeo, sharedMats.darkChassis, BESS_ACCENT, 0.65);
    rack.position.set(0, 1.4, 0);

    // Battery modular pack shelves with status LED bars
    for (let i = 0; i < 4; i += 1) {
      const shelfY = 0.45 + i * 0.62;
      const shelfGeo = new THREE.BoxGeometry(2.1, 0.35, 1.0);
      const shelf = addMeshWithEdges(g, shelfGeo, sharedMats.engineBlock, BESS_ACCENT, 0.5);
      shelf.position.set(0, shelfY, 0);

      // Glowing LED indicator bar on the front
      const ledGeo = new THREE.BoxGeometry(1.6, 0.06, 0.05);
      const led = new THREE.Mesh(ledGeo, sharedMats.bessLed);
      led.position.set(0, shelfY, 0.52);
      g.add(led);
    }

    // Top DC power bus conduit
    const busGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 10);
    busGeo.rotateZ(Math.PI / 2);
    const bus = addMeshWithEdges(g, busGeo, sharedMats.pipeAmber, FUEL_ACCENT, 0.7);
    bus.position.set(0, 2.9, 0);

    return g;
  }

  // ── Day Tank SAB-55 Fuel Storage ──────────────────────────────
  function createDayTank(x, y, z, r = 0.9, h = 2.6) {
    const g = new THREE.Group();
    g.position.set(x, y, z);

    // Upright cylindrical tank
    const tankGeo = new THREE.CylinderGeometry(r, r, h, 20);
    const tank = addMeshWithEdges(g, tankGeo, sharedMats.pipeAmber, FUEL_ACCENT, 0.8);
    tank.position.set(0, h / 2 + 0.4, 0);

    // Support cradle legs (4 legs)
    for (let i = 0; i < 4; i += 1) {
      const ang = (i * Math.PI) / 2 + Math.PI / 4;
      const lx = Math.cos(ang) * (r * 0.85);
      const lz = Math.sin(ang) * (r * 0.85);
      const legGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8);
      const leg = addMeshWithEdges(g, legGeo, sharedMats.darkChassis, BLUEPRINT_EDGE, 0.5);
      leg.position.set(lx, 0.25, lz);
    }

    // Sight gauge tube
    const sightGeo = new THREE.CylinderGeometry(0.04, 0.04, h * 0.7, 8);
    const sight = addMeshWithEdges(g, sightGeo, sharedMats.steel, FUEL_ACCENT, 0.9);
    sight.position.set(r + 0.06, h / 2 + 0.4, 0);

    // Top fuel intake & breather piping
    const pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8);
    const pipe = addMeshWithEdges(g, pipeGeo, sharedMats.steel, BLUEPRINT_EDGE, 0.5);
    pipe.position.set(0, h + 0.7, 0);

    return g;
  }

  // ── Water RO Plant (Reverse Osmosis) ───────────────────────────
  function createWaterROPlant(x, y, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;

    // Rack frame
    const frameGeo = new THREE.BoxGeometry(2.4, 1.8, 1.2);
    const frame = addMeshWithEdges(g, frameGeo, sharedMats.darkChassis, BLUEPRINT_EDGE, 0.5);
    frame.position.set(0, 0.9, 0);

    // 3x Horizontal RO membrane pressure tubes
    const tubePositions = [
      [0, 0.6, -0.3],
      [0, 0.6, 0.3],
      [0, 1.2, 0],
    ];
    tubePositions.forEach(([tx, ty, tz]) => {
      const tubeGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.2, 14);
      tubeGeo.rotateZ(Math.PI / 2);
      const tube = addMeshWithEdges(g, tubeGeo, sharedMats.steel, WATER_ACCENT, 0.75);
      tube.position.set(tx, ty, tz);
    });

    // High-pressure booster pump motor
    const pumpGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.7, 12);
    pumpGeo.rotateZ(Math.PI / 2);
    const pump = addMeshWithEdges(g, pumpGeo, sharedMats.engineBlock, BLUEPRINT_EDGE, 0.6);
    pump.position.set(0.6, 0.3, 0);

    // Water accumulator expansion dome tank
    const accGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.4, 14);
    const acc = addMeshWithEdges(g, accGeo, sharedMats.pipeWater, WATER_ACCENT, 0.8);
    acc.position.set(-0.8, 0.85, 0);

    return g;
  }

  // ── Thermal Loop Boilers & Heat Exchangers ─────────────────────
  function createThermalBoilers(x, y, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;

    // Dual vertical insulated hot water buffer calorifiers
    [-0.9, 0.9].forEach((ox) => {
      const calGeo = new THREE.CylinderGeometry(0.7, 0.7, 2.4, 16);
      const cal = addMeshWithEdges(g, calGeo, sharedMats.pipeHeat, HEAT_ACCENT, 0.8);
      cal.position.set(ox, 1.35, 0);

      const capGeo = new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const cap = addMeshWithEdges(g, capGeo, sharedMats.pipeHeat, HEAT_ACCENT, 0.7);
      cap.position.set(ox, 2.55, 0);
    });

    // Circulating pump skid with header manifold
    const hdrGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.6, 10);
    hdrGeo.rotateZ(Math.PI / 2);
    const hdr = addMeshWithEdges(g, hdrGeo, sharedMats.pipeHeat, HEAT_ACCENT, 0.9);
    hdr.position.set(0, 1.8, 0.85);

    const pumpGeo = new THREE.BoxGeometry(0.5, 0.7, 0.5);
    const pump = addMeshWithEdges(g, pumpGeo, sharedMats.darkChassis, BLUEPRINT_EDGE, 0.5);
    pump.position.set(0, 0.45, 0.85);

    return g;
  }

  // ── Cryo Storage Dewars & Scientific Analytics Rack ───────────
  function createCryoStorage(x, y, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;

    // 2x Vacuum-jacketed cryogenic liquid nitrogen/helium dewars
    [-0.75, 0.75].forEach((ox) => {
      const dewarGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.6, 16);
      const dewar = addMeshWithEdges(g, dewarGeo, sharedMats.cryoBody, CRYO_ACCENT, 0.85);
      dewar.position.set(ox, 0.95, 0);

      const sphereCapGeo = new THREE.SphereGeometry(0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const cap = addMeshWithEdges(g, sphereCapGeo, sharedMats.cryoBody, CRYO_ACCENT, 0.8);
      cap.position.set(ox, 1.75, 0);

      // Relief safety valve on collar
      const valveGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8);
      const valve = addMeshWithEdges(g, valveGeo, sharedMats.steel, BLUEPRINT_EDGE, 0.6);
      valve.position.set(ox, 2.1, 0);
    });

    // Environmental instrumentation / spectrometer rack
    const rackGeo = new THREE.BoxGeometry(1.2, 2.0, 0.7);
    const rack = addMeshWithEdges(g, rackGeo, sharedMats.darkChassis, BLUEPRINT_EDGE, 0.6);
    rack.position.set(0, 1.0, 1.1);

    return g;
  }

  // ── Satellite Transceiver Terminal ─────────────────────────────
  function createSatelliteTransceiver(x, y, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;

    // Transceiver equipment enclosure cabinet
    const cabGeo = new THREE.BoxGeometry(1.4, 1.8, 1.0);
    const cab = addMeshWithEdges(g, cabGeo, sharedMats.darkChassis, DG_ACCENT, 0.7);
    cab.position.set(0, 0.9, 0);

    // Waveguide feed conduit
    const wgGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.8, 8);
    const wg = addMeshWithEdges(g, wgGeo, sharedMats.steel, BLUEPRINT_EDGE, 0.6);
    wg.position.set(0.6, 1.4, 0);

    return g;
  }

  // ── HVAC Life Support Air Handling Unit ────────────────────────
  function createAirHandlingUnit(x, y, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;

    // Main dual-blower AHU enclosure
    const ahuGeo = new THREE.BoxGeometry(3.6, 1.8, 1.8);
    const ahu = addMeshWithEdges(g, ahuGeo, sharedMats.steel, BLUEPRINT_EDGE, 0.65);
    ahu.position.set(0, 1.0, 0);

    // Dual centrifugal blower scrolls
    [-0.9, 0.9].forEach((ox) => {
      const fanGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.7, 14);
      fanGeo.rotateZ(Math.PI / 2);
      const fan = addMeshWithEdges(g, fanGeo, sharedMats.darkChassis, BLUEPRINT_EDGE, 0.5);
      fan.position.set(ox, 1.0, 0);
    });

    // Air distribution trunk ducts
    const ductGeo = new THREE.BoxGeometry(3.8, 0.45, 0.7);
    const duct = addMeshWithEdges(g, ductGeo, sharedMats.darkChassis, BLUEPRINT_EDGE, 0.5);
    duct.position.set(0, 2.05, 0);

    return g;
  }

  // ── Station-specific placement ────────────────────────────────
  if (world.id === 'maitri') {
    // 1. Generator Shed (zone: 'generator', x: 48, z: -30, pad y = 0)
    // Fit DG Genset #1, DG Genset #2, BESS Battery Bank, and Day Tank SAB-55 inside
    root.add(createGenset(44.5, 0.1, -30, 0));             // DG Genset #1
    root.add(createGenset(48.5, 0.1, -30, 0));             // DG Genset #2
    root.add(createBESSBatteryBank(52.2, 0.1, -32, 0));    // BESS 240 kWh Battery Substation
    root.add(createDayTank(52.2, 0.1, -28));               // Day Tank SAB-55 Fuel Storage

    // 2. Lake-water Pump House & RO Plant (zone: 'waterTank', x: -74, z: 40, y = 1.0)
    root.add(createWaterROPlant(-74.0, 1.0, 40.0, 0));

    // 3. Thermal Loop Plant & Boilers (zone: 'heating', x: -24.5, z: 9.3, y = 1.8)
    root.add(createThermalBoilers(-24.5, 1.8, 7.5, 0));

    // 4. Secondary Heating Unit (zone: 'heatingB', x: 24.5, z: 9.3, y = 1.8)
    root.add(createThermalBoilers(24.5, 1.8, 7.5, 0));

    // 5. Scientific Research Containers (zone: 'lab', x: 42, z: 26.6, y = 0)
    // Fit Cryo Storage Dewars and Lab Instrumentation inside
    root.add(createCryoStorage(42.0, 0.1, 25.0, 0));

    // 6. Communications Shelter (zone: 'commsMast', x: 30, z: -50, y = 0.5)
    root.add(createSatelliteTransceiver(31.5, 0.5, -48.5, 0));

    // 7. Living Quarters & Life Support (zone: 'livingQuarters', x: 0, z: -12, y = 1.8)
    root.add(createAirHandlingUnit(0, 1.8, -12.0, 0));
  } else if (world.id === 'bharati') {
    // Bharati station layout (elevation: 35m cliff plateau, PAD_Y = 35)
    const y0 = 35.0; // Bharati pad base
    const LEGS = 2.6; // steel stilts
    const lo = y0 + LEGS; // 37.6m (lower container level: generators, labs, thermal)
    const mid = lo + 3.6; // 41.2m (upper level: living quarters)
    const top = lo + 7.8; // 45.4m (roof plant enclosure)

    // 1. Generator Bay in southern end of lower deck (z = 17.5)
    // DG Genset #1 & #2, BESS Battery Bank, and Day Tank SAB-55
    root.add(createGenset(-3.8, lo + 0.1, 17.5, 0));
    root.add(createGenset(3.8, lo + 0.1, 17.5, 0));
    root.add(createBESSBatteryBank(-3.8, lo + 0.1, 22.5, 0));
    root.add(createDayTank(3.8, lo + 0.1, 22.5));

    // 2. Sea-water Pump House & RO Plant down at the coast (zone: 'waterTank', x: 36, y: 6.0, z: -196)
    root.add(createWaterROPlant(36.0, 6.0 + 0.2, -196.0, 0));

    // 3. Scientific Research Labs & Cryo Storage in northern end of lower deck (z = -18.0)
    root.add(createCryoStorage(0, lo + 0.1, -18.0, 0));

    // 4. District Thermal Loop & Boilers in central lower deck (z = 0)
    root.add(createThermalBoilers(0, lo + 0.1, 0, 0));

    // 5. Communications Transceiver Shelter beside the lattice mast (x = 34, z = 10, y = 35)
    root.add(createSatelliteTransceiver(32.0, y0 + 0.2, 10.0, 0));

    // 6. Central Life Support & Air Handling Unit in upper living deck (z = 0, y = mid)
    root.add(createAirHandlingUnit(0, mid + 0.1, 0, 0));

    // 7. Roof plant auxiliary ventilation unit (z = 9.0, y = top)
    root.add(createAirHandlingUnit(0, top + 0.1, 9.0, 0));
  }

  root.visible = false;
  world.scene.add(root);

  return {
    group: root,
    setVisible(on) {
      root.visible = on;
    },
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      world.scene.remove(root);
    },
  };
}
