/* ═══════════════════════════════════════════════════════════════
   Aurora v2 — Dual-Station Simulation Engine
   Each station (Maitri / Bharati) runs INDEPENDENTLY:
   - Separate sensor states, alert states, history
   - Organic weather patterns (no button-driven normal operation)
   - Cascading failures through the dependency graph
   - Event timeline logging
   ═══════════════════════════════════════════════════════════════ */

// ── Station metadata ────────────────────────────────────────
export const STATIONS = {
  maitri: {
    id: 'maitri',
    name: 'Maitri',
    fullName: 'Maitri Research Station',
    location: '70°46\u2032S 11°44\u2032E',
    region: 'Schirmacher Oasis, Dronning Maud Land',
    established: 1989,
    personnel: 25,
    winterTemp: '-33°C avg',
    elevation: '123m',
  },
  bharati: {
    id: 'bharati',
    name: 'Bharati',
    fullName: 'Bharati Research Station',
    location: '69°24\u2032S 76°12\u2032E',
    region: 'Larsemann Hills, Prydz Bay',
    established: 2012,
    personnel: 47,
    winterTemp: '-25°C avg',
    elevation: '35m',
  },
};

// ── Station buildings definition ─────────────────────────────
export const BUILDINGS = {
  generator: {
    id: 'generator',
    name: 'Generator Shed',
    module: 'energy',
    position: [-8, 0, -3],
    size: [4, 3, 5],
    description: 'Primary & backup diesel generators',
    icon: 'fuel',
  },
  heating: {
    id: 'heating',
    name: 'Heating Zone A',
    module: 'infrastructure',
    position: [0, 0, -6],
    size: [6, 3.5, 5],
    description: 'Central heating distribution for living quarters',
    icon: 'flame',
  },
  heatingB: {
    id: 'heatingB',
    name: 'Heating Zone B',
    module: 'infrastructure',
    position: [8, 0, -4],
    size: [4, 3, 4],
    description: 'Secondary heating for labs and workshops',
    icon: 'flame',
  },
  waterTank: {
    id: 'waterTank',
    name: 'Water Treatment',
    module: 'infrastructure',
    position: [-6, 0, 6],
    size: [3, 4, 3],
    description: 'Snow-melt water purification and storage',
    icon: 'droplets',
  },
  commsMast: {
    id: 'commsMast',
    name: 'Comms Tower',
    module: 'infrastructure',
    position: [12, 0, 0],
    size: [2, 8, 2],
    description: 'Satellite uplink & local radio communications',
    icon: 'radio-tower',
  },
  livingQuarters: {
    id: 'livingQuarters',
    name: 'Living Quarters',
    module: 'infrastructure',
    position: [0, 0, 3],
    size: [10, 4, 6],
    description: 'Crew dormitories, galley, recreation',
    icon: 'house',
  },
  storage: {
    id: 'storage',
    name: 'Logistics Store',
    module: 'logistics',
    position: [-10, 0, 3],
    size: [5, 3, 4],
    description: 'Food, fuel drums, spare parts inventory',
    icon: 'package',
  },
  lab: {
    id: 'lab',
    name: 'Research Lab',
    module: 'environmental',
    position: [8, 0, 5],
    size: [5, 3.5, 5],
    description: 'Environmental monitoring & meteorological instruments',
    icon: 'microscope',
  },
};

// ── Dependency graph ────────────────────────────────────────
export const DEPENDENCY_GRAPH = {
  generator:       { depends: [], feeds: ['heating', 'heatingB', 'waterTank', 'commsMast', 'livingQuarters', 'lab'] },
  heating:         { depends: ['generator'], feeds: ['livingQuarters'] },
  heatingB:        { depends: ['generator'], feeds: ['lab'] },
  waterTank:       { depends: ['generator'], feeds: ['livingQuarters', 'lab'] },
  commsMast:       { depends: ['generator'], feeds: [] },
  livingQuarters:  { depends: ['heating', 'waterTank'], feeds: [] },
  storage:         { depends: [], feeds: [] },
  lab:             { depends: ['heatingB', 'waterTank'], feeds: [] },
};

// ── Station-specific sensor baselines ───────────────────────
// Bharati is newer, warmer, more personnel → different nominals
const STATION_PROFILES = {
  maitri: {
    env_temp: -33, env_wind: 35, env_pressure: 986, env_humidity: 55,
    gen_power: 160, gen_fuel_rate: 28, gen_rpm: 1500, gen_temp: 82,
    heat_a_flow: 35, heat_a_temp: 72, heat_a_pressure: 3.2,
    heat_b_flow: 28, heat_b_temp: 68,
    water_level: 78, water_temp: 12, water_ph: 7.1,
    comms_signal: -42, comms_bandwidth: 2.4, comms_uptime: 99.2,
    lq_temp: 21, lq_humidity: 42, lq_co2: 620,
    store_fuel: 142, store_food: 186, store_spares: 312,
  },
  bharati: {
    env_temp: -25, env_wind: 28, env_pressure: 998, env_humidity: 48,
    gen_power: 172, gen_fuel_rate: 32, gen_rpm: 1520, gen_temp: 78,
    heat_a_flow: 38, heat_a_temp: 74, heat_a_pressure: 3.4,
    heat_b_flow: 30, heat_b_temp: 70,
    water_level: 82, water_temp: 14, water_ph: 7.0,
    comms_signal: -38, comms_bandwidth: 3.1, comms_uptime: 99.5,
    lq_temp: 22, lq_humidity: 40, lq_co2: 580,
    store_fuel: 154, store_food: 210, store_spares: 380,
  },
};

// ── Sensor definitions per building ─────────────────────────
function makeSensorDefs(profile) {
  return {
    generator: [
      { id: 'gen_power', name: 'Power Output', unit: 'kW', min: 0, max: 200, nominal: profile.gen_power, step: 2, warningLow: 80, criticalLow: 40 },
      { id: 'gen_fuel_rate', name: 'Fuel Rate', unit: 'L/hr', min: 0, max: 50, nominal: profile.gen_fuel_rate, step: 0.5 },
      { id: 'gen_rpm', name: 'Engine RPM', unit: 'rpm', min: 0, max: 2000, nominal: profile.gen_rpm, step: 10, warningLow: 1200, criticalLow: 800 },
      { id: 'gen_temp', name: 'Engine Temp', unit: '°C', min: 0, max: 120, nominal: profile.gen_temp, step: 0.5, warningHigh: 95, criticalHigh: 105 },
    ],
    heating: [
      { id: 'heat_a_flow', name: 'Flow Rate', unit: 'L/min', min: 0, max: 50, nominal: profile.heat_a_flow, step: 0.3 },
      { id: 'heat_a_temp', name: 'Output Temp', unit: '°C', min: 0, max: 90, nominal: profile.heat_a_temp, step: 0.4, warningLow: 55, criticalLow: 40 },
      { id: 'heat_a_pressure', name: 'Pressure', unit: 'bar', min: 0, max: 6, nominal: profile.heat_a_pressure, step: 0.05 },
    ],
    heatingB: [
      { id: 'heat_b_flow', name: 'Flow Rate', unit: 'L/min', min: 0, max: 40, nominal: profile.heat_b_flow, step: 0.3 },
      { id: 'heat_b_temp', name: 'Output Temp', unit: '°C', min: 0, max: 90, nominal: profile.heat_b_temp, step: 0.4, warningLow: 50, criticalLow: 35 },
    ],
    waterTank: [
      { id: 'water_level', name: 'Tank Level', unit: '%', min: 0, max: 100, nominal: profile.water_level, step: 0.2, warningLow: 25, criticalLow: 10 },
      { id: 'water_temp', name: 'Water Temp', unit: '°C', min: 0, max: 30, nominal: profile.water_temp, step: 0.2 },
      { id: 'water_ph', name: 'pH Level', unit: 'pH', min: 5, max: 9, nominal: profile.water_ph, step: 0.02 },
    ],
    commsMast: [
      { id: 'comms_signal', name: 'Signal Strength', unit: 'dBm', min: -120, max: 0, nominal: profile.comms_signal, step: 1, warningLow: -80, criticalLow: -100 },
      { id: 'comms_bandwidth', name: 'Bandwidth', unit: 'Mbps', min: 0, max: 10, nominal: profile.comms_bandwidth, step: 0.1 },
      { id: 'comms_uptime', name: 'Uptime', unit: '%', min: 0, max: 100, nominal: profile.comms_uptime, step: 0.05 },
    ],
    livingQuarters: [
      { id: 'lq_temp', name: 'Interior Temp', unit: '°C', min: 10, max: 30, nominal: profile.lq_temp, step: 0.2, warningLow: 16, criticalLow: 12 },
      { id: 'lq_humidity', name: 'Humidity', unit: '%', min: 10, max: 80, nominal: profile.lq_humidity, step: 0.5 },
      { id: 'lq_co2', name: 'CO\u2082 Level', unit: 'ppm', min: 300, max: 2000, nominal: profile.lq_co2, step: 5, warningHigh: 1200, criticalHigh: 1500 },
    ],
    storage: [
      { id: 'store_fuel', name: 'Fuel Stock', unit: 'kL', min: 0, max: 200, nominal: profile.store_fuel, step: 0.1, warningLow: 40, criticalLow: 15 },
      { id: 'store_food', name: 'Food Stores', unit: 'days', min: 0, max: 365, nominal: profile.store_food, step: 0.08, warningLow: 30, criticalLow: 14 },
      { id: 'store_spares', name: 'Spare Parts', unit: 'items', min: 0, max: 500, nominal: profile.store_spares, step: 0.05, warningLow: 50, criticalLow: 20 },
    ],
    lab: [
      { id: 'env_temp', name: 'Outside Temp', unit: '°C', min: -60, max: 5, nominal: profile.env_temp, step: 0.3 },
      { id: 'env_wind', name: 'Wind Speed', unit: 'km/h', min: 0, max: 200, nominal: profile.env_wind, step: 1.5, warningHigh: 80, criticalHigh: 120 },
      { id: 'env_pressure', name: 'Barometric', unit: 'hPa', min: 940, max: 1040, nominal: profile.env_pressure, step: 0.3 },
      { id: 'env_humidity', name: 'Ext Humidity', unit: '%', min: 10, max: 100, nominal: profile.env_humidity, step: 0.5 },
    ],
  };
}

// ── Inventory data (logistics module) ───────────────────────
export const INVENTORY_PROFILES = {
  maitri: [
    { id: 'inv_diesel', name: 'Diesel Fuel', category: 'fuel', current: 142000, max: 200000, unit: 'L', reorderAt: 40000, dailyUse: 680 },
    { id: 'inv_kerosene', name: 'Kerosene', category: 'fuel', current: 18500, max: 30000, unit: 'L', reorderAt: 5000, dailyUse: 120 },
    { id: 'inv_food_rations', name: 'Food Rations', category: 'food', current: 186, max: 365, unit: 'days', reorderAt: 30, dailyUse: 1 },
    { id: 'inv_fresh_water', name: 'Fresh Water Reserve', category: 'water', current: 45000, max: 60000, unit: 'L', reorderAt: 15000, dailyUse: 800 },
    { id: 'inv_gen_filters', name: 'Generator Filters', category: 'spares', current: 24, max: 50, unit: 'pcs', reorderAt: 8, dailyUse: 0.07 },
    { id: 'inv_heating_parts', name: 'Heating System Spares', category: 'spares', current: 18, max: 40, unit: 'kits', reorderAt: 6, dailyUse: 0.03 },
    { id: 'inv_medical', name: 'Medical Supplies', category: 'medical', current: 92, max: 100, unit: '%', reorderAt: 30, dailyUse: 0.1 },
    { id: 'inv_batteries', name: 'Battery Packs', category: 'spares', current: 56, max: 100, unit: 'pcs', reorderAt: 15, dailyUse: 0.15 },
  ],
  bharati: [
    { id: 'inv_diesel', name: 'Diesel Fuel', category: 'fuel', current: 154000, max: 220000, unit: 'L', reorderAt: 45000, dailyUse: 750 },
    { id: 'inv_kerosene', name: 'Kerosene', category: 'fuel', current: 22000, max: 35000, unit: 'L', reorderAt: 6000, dailyUse: 140 },
    { id: 'inv_food_rations', name: 'Food Rations', category: 'food', current: 210, max: 365, unit: 'days', reorderAt: 30, dailyUse: 1 },
    { id: 'inv_fresh_water', name: 'Fresh Water Reserve', category: 'water', current: 52000, max: 70000, unit: 'L', reorderAt: 18000, dailyUse: 950 },
    { id: 'inv_gen_filters', name: 'Generator Filters', category: 'spares', current: 32, max: 60, unit: 'pcs', reorderAt: 10, dailyUse: 0.08 },
    { id: 'inv_heating_parts', name: 'Heating System Spares', category: 'spares', current: 22, max: 50, unit: 'kits', reorderAt: 8, dailyUse: 0.04 },
    { id: 'inv_medical', name: 'Medical Supplies', category: 'medical', current: 96, max: 100, unit: '%', reorderAt: 30, dailyUse: 0.08 },
    { id: 'inv_batteries', name: 'Battery Packs', category: 'spares', current: 68, max: 120, unit: 'pcs', reorderAt: 20, dailyUse: 0.12 },
  ],
};

// Legacy export for backward compat
export const INVENTORY = INVENTORY_PROFILES.maitri;

// ═══════════════════════════════════════════════════════════════
// ORGANIC EVENT ENGINE
// Instead of button-driven events, weather & equipment naturally
// drift and cascade through the dependency graph.
// ═══════════════════════════════════════════════════════════════

// Weather pattern types that develop organically
const WEATHER_PATTERNS = {
  coldSnap: {
    name: 'Cold Snap',
    probability: 0.003,  // ~0.3% per tick (every ~5-6 min at 2s ticks)
    duration: [30, 60],  // 30-60 ticks (1-2 min)
    effects: {
      env_temp: { drift: -0.8, volatility: 1.5 },
      env_wind: { drift: 0.5, volatility: 2 },
      env_pressure: { drift: -0.4, volatility: 0.5 },
    },
  },
  storm: {
    name: 'Blizzard',
    probability: 0.002,
    duration: [40, 80],
    effects: {
      env_wind: { drift: 2.0, volatility: 4 },
      env_temp: { drift: -0.5, volatility: 1 },
      comms_signal: { drift: -2, volatility: 3 },
    },
  },
  warmSpell: {
    name: 'Warm Front',
    probability: 0.002,
    duration: [20, 50],
    effects: {
      env_temp: { drift: 0.6, volatility: 1 },
      env_pressure: { drift: 0.3, volatility: 0.4 },
    },
  },
  signalDegradation: {
    name: 'Signal Interference',
    probability: 0.0015,
    duration: [20, 40],
    effects: {
      comms_signal: { drift: -3, volatility: 5 },
      comms_bandwidth: { drift: -0.15, volatility: 0.2 },
    },
  },
  equipmentAging: {
    name: 'Equipment Stress',
    probability: 0.001,
    duration: [50, 100],
    effects: {
      gen_temp: { drift: 0.3, volatility: 0.8 },
      gen_rpm: { drift: -3, volatility: 5 },
    },
  },
};

// Cascade rules: when an upstream system degrades, downstream feels it
const CASCADE_RULES = {
  // If outside temp drops, heating demand increases → more power needed
  env_temp: (val, state) => {
    if (val < -40) {
      return [
        { building: 'heating', sensor: 'heat_a_flow', nudge: 0.3 },
        { building: 'heatingB', sensor: 'heat_b_flow', nudge: 0.2 },
        { building: 'generator', sensor: 'gen_power', nudge: 0.5 },
        { building: 'generator', sensor: 'gen_fuel_rate', nudge: 0.15 },
        { building: 'generator', sensor: 'gen_temp', nudge: 0.1 },
      ];
    }
    if (val < -35) {
      return [
        { building: 'heating', sensor: 'heat_a_flow', nudge: 0.15 },
        { building: 'generator', sensor: 'gen_power', nudge: 0.3 },
      ];
    }
    return [];
  },
  // If generator power drops, everything downstream degrades
  gen_power: (val, state) => {
    if (val < 80) {
      return [
        { building: 'heating', sensor: 'heat_a_temp', nudge: -0.5 },
        { building: 'heatingB', sensor: 'heat_b_temp', nudge: -0.4 },
        { building: 'livingQuarters', sensor: 'lq_temp', nudge: -0.3 },
        { building: 'commsMast', sensor: 'comms_signal', nudge: -1 },
      ];
    }
    return [];
  },
  // If generator temp rises, RPM and power degrade
  gen_temp: (val, state) => {
    if (val > 95) {
      return [
        { building: 'generator', sensor: 'gen_rpm', nudge: -5 },
        { building: 'generator', sensor: 'gen_power', nudge: -1 },
      ];
    }
    return [];
  },
  // If wind speed is extreme, comms degrade
  env_wind: (val, state) => {
    if (val > 80) {
      return [
        { building: 'commsMast', sensor: 'comms_signal', nudge: -1.5 },
        { building: 'commsMast', sensor: 'comms_bandwidth', nudge: -0.05 },
      ];
    }
    return [];
  },
};

// ═══════════════════════════════════════════════════════════════
// PER-STATION SIMULATION STATE
// Each station is a completely independent simulation instance.
// ═══════════════════════════════════════════════════════════════
const stationStates = {};    // stationId → { sensorValues, alertStates, history, events, activePatterns, ... }
let listeners = new Set();
let tickInterval = null;
const HISTORY_LENGTH = 60;

function createStationState(stationId) {
  const profile = STATION_PROFILES[stationId];
  const sensorDefs = makeSensorDefs(profile);
  const sensorValues = {};
  const sensorHistory = {};
  const alertStates = {};

  Object.entries(sensorDefs).forEach(([buildingId, sensors]) => {
    sensorValues[buildingId] = {};
    sensorHistory[buildingId] = {};
    sensors.forEach(sensor => {
      const jitter = (Math.random() - 0.5) * sensor.step * 4;
      sensorValues[buildingId][sensor.id] = Math.max(sensor.min, Math.min(sensor.max, sensor.nominal + jitter));
      sensorHistory[buildingId][sensor.id] = [];
    });
    alertStates[buildingId] = 'normal';
  });

  return {
    stationId,
    profile,
    sensorDefs,
    sensorValues,
    sensorHistory,
    alertStates,
    activePatterns: [],      // Currently active weather/equipment patterns
    eventTimeline: [],       // Chronological event log
    incidentCounter: 0,      // Unique incident ID
    tickCount: 0,
    signalQuality: 100,      // 0-100% for connectivity degradation
    signalTrend: 0,          // -1 degrading, 0 stable, 1 recovering
    signalDegradeTicksLeft: 0,
  };
}

// ── Tick a single station ───────────────────────────────────
function tickStation(state) {
  const now = Date.now();
  state.tickCount++;
  const { sensorDefs, sensorValues, sensorHistory, alertStates, activePatterns } = state;

  // 1. Try to spawn organic weather patterns
  Object.entries(WEATHER_PATTERNS).forEach(([patternId, pattern]) => {
    // Don't stack the same pattern
    if (activePatterns.some(p => p.id === patternId)) return;
    if (Math.random() < pattern.probability) {
      const duration = pattern.duration[0] + Math.random() * (pattern.duration[1] - pattern.duration[0]);
      activePatterns.push({
        id: patternId,
        name: pattern.name,
        effects: pattern.effects,
        ticksRemaining: Math.round(duration),
        startTick: state.tickCount,
      });
      addEvent(state, 'pattern_start', `${pattern.name} developing`, { pattern: patternId });
    }
  });

  // 2. Organic signal degradation/recovery
  if (state.signalDegradeTicksLeft > 0) {
    state.signalDegradeTicksLeft--;
    state.signalQuality = Math.max(0, state.signalQuality + state.signalTrend * (1 + Math.random()));
    state.signalQuality = Math.min(100, Math.max(0, state.signalQuality));
  } else if (Math.random() < 0.001) {
    // Start organic signal degradation
    state.signalTrend = -1;
    state.signalDegradeTicksLeft = 15 + Math.floor(Math.random() * 20);
    addEvent(state, 'connectivity', 'Signal quality degrading', { quality: state.signalQuality });
  } else if (state.signalQuality < 100 && state.signalDegradeTicksLeft === 0) {
    // Auto-recover
    state.signalTrend = 1;
    state.signalDegradeTicksLeft = 10 + Math.floor(Math.random() * 10);
    addEvent(state, 'connectivity', 'Signal recovering', { quality: state.signalQuality });
  }

  // 3. Apply active weather pattern effects + normal random walk
  Object.entries(sensorDefs).forEach(([buildingId, sensors]) => {
    let buildingAlertLevel = 'normal';

    sensors.forEach(sensor => {
      const current = sensorValues[buildingId][sensor.id];

      // Base mean-reverting random walk
      const meanReversion = (sensor.nominal - current) * 0.02;
      const noise = (Math.random() - 0.5) * 2 * sensor.step;
      let delta = meanReversion + noise;

      // Apply active weather pattern effects
      activePatterns.forEach(pattern => {
        const effect = pattern.effects[sensor.id];
        if (effect) {
          delta += effect.drift + (Math.random() - 0.5) * effect.volatility;
        }
      });

      let next = current + delta;
      next = Math.max(sensor.min, Math.min(sensor.max, next));
      sensorValues[buildingId][sensor.id] = Math.round(next * 100) / 100;

      // Record history
      const history = sensorHistory[buildingId][sensor.id];
      history.push({ time: now, value: next });
      if (history.length > HISTORY_LENGTH) history.shift();

      // Check thresholds
      if (sensor.criticalHigh && next >= sensor.criticalHigh) buildingAlertLevel = 'critical';
      else if (sensor.criticalLow && next <= sensor.criticalLow) buildingAlertLevel = 'critical';
      else if (sensor.warningHigh && next >= sensor.warningHigh && buildingAlertLevel !== 'critical') buildingAlertLevel = 'warning';
      else if (sensor.warningLow && next <= sensor.warningLow && buildingAlertLevel !== 'critical') buildingAlertLevel = 'warning';
    });

    // Log alert state changes
    const prevAlert = alertStates[buildingId];
    if (buildingAlertLevel !== prevAlert) {
      if (buildingAlertLevel === 'warning' || buildingAlertLevel === 'critical') {
        addEvent(state, 'alert', `${BUILDINGS[buildingId]?.name} → ${buildingAlertLevel.toUpperCase()}`, {
          building: buildingId,
          severity: buildingAlertLevel,
        });
      } else if (prevAlert !== 'normal') {
        addEvent(state, 'resolved', `${BUILDINGS[buildingId]?.name} returned to NORMAL`, {
          building: buildingId,
        });
      }
    }

    alertStates[buildingId] = buildingAlertLevel;
  });

  // 4. Apply cascade rules
  Object.entries(CASCADE_RULES).forEach(([sensorId, ruleFn]) => {
    // Find which building has this sensor
    for (const [buildingId, sensors] of Object.entries(sensorDefs)) {
      const sensorDef = sensors.find(s => s.id === sensorId);
      if (sensorDef && sensorValues[buildingId]?.[sensorId] !== undefined) {
        const val = sensorValues[buildingId][sensorId];
        const nudges = ruleFn(val, state);
        nudges.forEach(({ building, sensor, nudge }) => {
          if (sensorValues[building]?.[sensor] !== undefined) {
            const def = sensorDefs[building]?.find(s => s.id === sensor);
            if (def) {
              let v = sensorValues[building][sensor] + nudge;
              v = Math.max(def.min, Math.min(def.max, v));
              sensorValues[building][sensor] = Math.round(v * 100) / 100;
            }
          }
        });
        break;
      }
    }
  });

  // 5. Expire finished weather patterns
  for (let i = activePatterns.length - 1; i >= 0; i--) {
    activePatterns[i].ticksRemaining--;
    if (activePatterns[i].ticksRemaining <= 0) {
      addEvent(state, 'pattern_end', `${activePatterns[i].name} subsiding`, { pattern: activePatterns[i].id });
      activePatterns.splice(i, 1);
    }
  }
}

// ── Event Timeline ──────────────────────────────────────────
function addEvent(state, type, message, data = {}) {
  state.eventTimeline.push({
    id: `${state.stationId}-evt-${++state.incidentCounter}`,
    type,       // 'alert' | 'resolved' | 'pattern_start' | 'pattern_end' | 'automation' | 'connectivity' | 'decision'
    message,
    data,
    timestamp: Date.now(),
  });
  // Keep last 200 events
  if (state.eventTimeline.length > 200) {
    state.eventTimeline.shift();
  }
}

// Expose for decision engine to add events
export function addStationEvent(stationId, type, message, data) {
  const state = stationStates[stationId];
  if (state) addEvent(state, type, message, data);
}

// ── Global tick (ticks all stations) ────────────────────────
function tickAll() {
  Object.values(stationStates).forEach(tickStation);
  listeners.forEach(fn => fn());
}

// ── Public API ──────────────────────────────────────────────
export function getSnapshot(stationId = 'maitri') {
  const state = stationStates[stationId];
  if (!state) return { sensors: {}, alerts: {}, history: {}, timestamp: Date.now(), eventTimeline: [], signalQuality: 100, activePatterns: [] };
  return {
    sensors: { ...state.sensorValues },
    alerts: { ...state.alertStates },
    history: state.sensorHistory,
    timestamp: Date.now(),
    eventTimeline: [...state.eventTimeline],
    signalQuality: state.signalQuality,
    activePatterns: state.activePatterns.map(p => ({ id: p.id, name: p.name, ticksRemaining: p.ticksRemaining })),
  };
}

export function getSensorDefs(buildingId, stationId = 'maitri') {
  const state = stationStates[stationId];
  if (!state) return [];
  return state.sensorDefs[buildingId] || [];
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startSimulation(intervalMs = 2000) {
  if (tickInterval) return;
  // Initialize both stations
  stationStates.maitri = createStationState('maitri');
  stationStates.bharati = createStationState('bharati');
  tickInterval = setInterval(tickAll, intervalMs);
  tickAll(); // Immediate first tick
}

export function stopSimulation() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// ── Force an anomaly on a specific building (for dev/test mode) ──
export function injectAnomaly(buildingId, sensorId, targetValue, stationId = 'maitri') {
  const state = stationStates[stationId];
  if (state?.sensorValues[buildingId]?.[sensorId] !== undefined) {
    state.sensorValues[buildingId][sensorId] = targetValue;
    addEvent(state, 'injection', `[DEV] Injected ${sensorId} = ${targetValue} on ${buildingId}`, {
      building: buildingId,
      sensor: sensorId,
      value: targetValue,
    });
  }
}

// ── Active alerts list (for alert panel) ────────────────────
export function getActiveAlerts(snapshot) {
  const alerts = [];
  Object.entries(snapshot.alerts).forEach(([buildingId, level]) => {
    if (level !== 'normal') {
      const building = BUILDINGS[buildingId];
      // We need sensor defs to find triggered sensors — use a generic approach
      const sensorVals = snapshot.sensors[buildingId] || {};
      const triggeredSensors = [];

      // Check each sensor value against known thresholds
      Object.entries(sensorVals).forEach(([sensorId, val]) => {
        // Find sensor def in any station profile
        for (const stId of Object.keys(stationStates)) {
          const def = stationStates[stId]?.sensorDefs[buildingId]?.find(s => s.id === sensorId);
          if (def) {
            const isTriggered = (def.criticalHigh && val >= def.criticalHigh) ||
                                (def.criticalLow && val <= def.criticalLow) ||
                                (def.warningHigh && val >= def.warningHigh) ||
                                (def.warningLow && val <= def.warningLow);
            if (isTriggered) {
              triggeredSensors.push({ name: def.name, value: val, unit: def.unit });
            }
            break;
          }
        }
      });

      alerts.push({
        buildingId,
        buildingName: building?.name || buildingId,
        level,
        module: building?.module,
        triggeredSensors,
        timestamp: snapshot.timestamp,
      });
    }
  });

  alerts.sort((a, b) => (a.level === 'critical' ? -1 : 1) - (b.level === 'critical' ? -1 : 1));
  return alerts;
}

// ── Get event timeline for a station ────────────────────────
export function getEventTimeline(stationId = 'maitri') {
  return stationStates[stationId]?.eventTimeline || [];
}

// ── Get inventory for a station ─────────────────────────────
export function getInventory(stationId = 'maitri') {
  return INVENTORY_PROFILES[stationId] || INVENTORY_PROFILES.maitri;
}
