/* ═══════════════════════════════════════════════════════════════
   Aurora v2 — Dual-Station Simulation Engine
   Each station (Maitri / Bharati) runs INDEPENDENTLY:
   - Separate sensor states, alert states, history
   - Organic weather patterns (no button-driven normal operation)
   - Cascading failures through the dependency graph
   - Event timeline logging
   ═══════════════════════════════════════════════════════════════ */

import {
  STATION_IDS, stationMeta, formatCoords, buildingList, dependencyGraph, sensorCatalog,
} from './stationConfig';

// ── Station metadata — from simulator/station_config.json ───
export const STATIONS = Object.fromEntries(STATION_IDS.map((id) => {
  const m = stationMeta(id);
  return [id, {
    id,
    name: m.name,
    fullName: m.fullName,
    coords: formatCoords(id),
    region: m.region,
    established: m.commissionedYear,
    personnel: m.personnelWinter,
    elevation: m.elevation_m != null ? `${m.elevation_m} m` : '—',
    winterTemp: m.winterMeanTemp_C != null ? `${m.winterMeanTemp_C} °C avg` : 'not established',
  }];
}));

// ── 3D / 2D layout (rendering only; ids, names and descriptions come from the config) ──
const BUILDING_LAYOUT = {
  generator:      { position: [-8, 0, -3], size: [4, 3, 5], icon: 'fuel' },
  heating:        { position: [0, 0, -6], size: [6, 3.5, 5], icon: 'flame' },
  heatingB:       { position: [8, 0, -4], size: [4, 3, 4], icon: 'flame' },
  waterTank:      { position: [-6, 0, 6], size: [3, 4, 3], icon: 'droplets' },
  commsMast:      { position: [12, 0, 0], size: [2, 8, 2], icon: 'radio-tower' },
  livingQuarters: { position: [0, 0, 3], size: [10, 4, 6], icon: 'house' },
  storage:        { position: [-10, 0, 3], size: [5, 3, 4], icon: 'package' },
  lab:            { position: [8, 0, 5], size: [5, 3.5, 5], icon: 'microscope' },
};

// Both stations share the same building layout in the config.
export const BUILDINGS = Object.fromEntries(buildingList(STATION_IDS[0]).map((b) => [b.id, {
  id: b.id,
  name: b.name,
  module: b.module,
  description: b.description,
  abbr: b.abbr,
  ...(BUILDING_LAYOUT[b.id] || { position: [0, 0, 0], size: [3, 3, 3], icon: 'box' }),
}]));

// ── Dependency graph — from the config edge list ─────────────
export const DEPENDENCY_GRAPH = dependencyGraph(STATION_IDS[0]);

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
// Browser-demo random-walk parameters (nominal/step/min/max) stay here; names,
// units and alert thresholds come from station_config.json.
const DEMO_RANGES = {
  generator: [['gen_power', 0, 200, 2], ['gen_fuel_rate', 0, 50, 0.5], ['gen_rpm', 0, 2000, 10], ['gen_temp', 0, 120, 0.5]],
  heating: [['heat_a_flow', 0, 50, 0.3], ['heat_a_temp', 0, 90, 0.4], ['heat_a_pressure', 0, 6, 0.05]],
  heatingB: [['heat_b_flow', 0, 40, 0.3], ['heat_b_temp', 0, 90, 0.4]],
  waterTank: [['water_level', 0, 100, 0.2], ['water_temp', 0, 30, 0.2], ['water_ph', 5, 9, 0.02]],
  commsMast: [['comms_signal', -120, 0, 1], ['comms_bandwidth', 0, 10, 0.1], ['comms_uptime', 0, 100, 0.05]],
  livingQuarters: [['lq_temp', 10, 30, 0.2], ['lq_humidity', 10, 80, 0.5], ['lq_co2', 300, 2000, 5]],
  storage: [['store_fuel', 0, 200, 0.1], ['store_food', 0, 365, 0.08], ['store_spares', 0, 500, 0.05]],
  lab: [['env_temp', -60, 5, 0.3], ['env_wind', 0, 200, 1.5], ['env_pressure', 940, 1040, 0.3], ['env_humidity', 10, 100, 0.5]],
};

function makeSensorDefs(profile, stationId) {
  const catalog = sensorCatalog(stationId);
  return Object.fromEntries(Object.entries(DEMO_RANGES).map(([buildingId, sensors]) => [
    buildingId,
    sensors.map(([id, min, max, step]) => {
      const c = catalog[id] || {};
      return {
        id, name: c.name || id, unit: c.unit || '', min, max, step, nominal: profile[id],
        warningLow: c.low?.warning, criticalLow: c.low?.critical,
        warningHigh: c.high?.warning, criticalHigh: c.high?.critical,
      };
    }),
  ]));
}

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
  env_temp: (val, _state) => {
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
  gen_power: (val, _state) => {
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
  gen_temp: (val, _state) => {
    if (val > 95) {
      return [
        { building: 'generator', sensor: 'gen_rpm', nudge: -5 },
        { building: 'generator', sensor: 'gen_power', nudge: -1 },
      ];
    }
    return [];
  },
  // If wind speed is extreme, comms degrade
  env_wind: (val, _state) => {
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
  const sensorDefs = makeSensorDefs(profile, stationId);
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
      if (sensor.criticalHigh != null && next >= sensor.criticalHigh) buildingAlertLevel = 'critical';
      else if (sensor.criticalLow != null && next <= sensor.criticalLow) buildingAlertLevel = 'critical';
      else if (sensor.warningHigh != null && next >= sensor.warningHigh && buildingAlertLevel !== 'critical') buildingAlertLevel = 'warning';
      else if (sensor.warningLow != null && next <= sensor.warningLow && buildingAlertLevel !== 'critical') buildingAlertLevel = 'warning';
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
            const isTriggered = (def.criticalHigh != null && val >= def.criticalHigh) ||
                                (def.criticalLow != null && val <= def.criticalLow) ||
                                (def.warningHigh != null && val >= def.warningHigh) ||
                                (def.warningLow != null && val <= def.warningLow);
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

