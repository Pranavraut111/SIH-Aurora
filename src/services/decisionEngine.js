/* ═══════════════════════════════════════════════════════════════
   Aurora v2 — Decision Engine
   Transforms raw anomalies into actionable incidents:
   What happened → Why → What's affected → Risk → Action → Outcome
   
   Uses the dependency graph to trace cascade impact.
   Pre-defined playbooks for automated responses.
   ═══════════════════════════════════════════════════════════════ */
import { BUILDINGS, DEPENDENCY_GRAPH, addStationEvent } from '../data/stationData';

// ── Playbooks ───────────────────────────────────────────────
// Each playbook defines what to do when a specific condition is met.
const PLAYBOOKS = {
  generator_overheat: {
    condition: (sensors, alerts) => {
      const genTemp = sensors.generator?.gen_temp;
      return genTemp && genTemp > 95;
    },
    title: 'Generator Overheating',
    cause: 'Engine temperature exceeds safe operating threshold',
    correlatedSensors: ['gen_temp', 'gen_rpm', 'gen_power', 'gen_fuel_rate'],
    recommendation: 'Reduce non-critical loads and activate cooling protocol',
    recommendedAction: 'Load shedding initiated — non-critical systems throttled',
    riskLevel: 'HIGH',
  },
  generator_failure: {
    condition: (sensors, alerts) => {
      const genPower = sensors.generator?.gen_power;
      return genPower && genPower < 40;
    },
    title: 'Generator Critical Failure',
    cause: 'Power output dropped below minimum operational threshold',
    correlatedSensors: ['gen_power', 'gen_rpm', 'gen_temp'],
    recommendation: 'Activate backup generator immediately. Dispatch maintenance team.',
    recommendedAction: 'Backup generator activated. Emergency power routing engaged.',
    riskLevel: 'CRITICAL',
  },
  extreme_cold: {
    condition: (sensors) => {
      const temp = sensors.lab?.env_temp;
      return temp && temp < -45;
    },
    title: 'Extreme Cold Event',
    cause: 'Outside temperature has dropped to dangerous levels',
    correlatedSensors: ['env_temp', 'env_wind', 'env_pressure'],
    recommendation: 'Increase heating output. Restrict outdoor activities. Monitor fuel consumption.',
    recommendedAction: 'Heating zones switched to maximum output. Fuel burn rate increased.',
    riskLevel: 'HIGH',
  },
  cold_warning: {
    condition: (sensors) => {
      const temp = sensors.lab?.env_temp;
      return temp && temp < -38 && temp >= -45;
    },
    title: 'Cold Front Approaching',
    cause: 'Temperature declining below seasonal norms',
    correlatedSensors: ['env_temp', 'env_wind', 'heat_a_flow'],
    recommendation: 'Pre-heat facilities. Verify fuel reserves.',
    recommendedAction: 'Heating output increased by 15%.',
    riskLevel: 'MODERATE',
  },
  high_wind: {
    condition: (sensors) => {
      const wind = sensors.lab?.env_wind;
      return wind && wind > 80;
    },
    title: 'High Wind Warning',
    cause: 'Wind speed exceeds safe operational limits',
    correlatedSensors: ['env_wind', 'comms_signal', 'comms_bandwidth'],
    recommendation: 'Secure outdoor equipment. Suspend EVA activities. Monitor comms stability.',
    recommendedAction: 'External sensor polling reduced to conserve bandwidth.',
    riskLevel: 'HIGH',
  },
  comms_degraded: {
    condition: (sensors) => {
      const signal = sensors.commsMast?.comms_signal;
      return signal && signal < -80;
    },
    title: 'Communications Degraded',
    cause: 'Satellite signal strength below reliable threshold',
    correlatedSensors: ['comms_signal', 'comms_bandwidth', 'comms_uptime'],
    recommendation: 'Switch to priority-only data transmission. Buffer routine telemetry.',
    recommendedAction: 'Priority queue activated. Routine telemetry buffered locally.',
    riskLevel: 'MODERATE',
  },
  heating_failure: {
    condition: (sensors) => {
      const heatTemp = sensors.heating?.heat_a_temp;
      return heatTemp && heatTemp < 40;
    },
    title: 'Heating System Failure',
    cause: 'Heating Zone A output temperature critically low',
    correlatedSensors: ['heat_a_temp', 'heat_a_flow', 'heat_a_pressure'],
    recommendation: 'Activate backup heating. Check coolant circulation. Inspect heat exchanger.',
    recommendedAction: 'Heating Zone B load redistributed to compensate.',
    riskLevel: 'CRITICAL',
  },
  water_low: {
    condition: (sensors) => {
      const level = sensors.waterTank?.water_level;
      return level && level < 25;
    },
    title: 'Water Reserve Low',
    cause: 'Fresh water tank level approaching minimum',
    correlatedSensors: ['water_level', 'water_temp', 'water_ph'],
    recommendation: 'Activate snow-melt processing. Restrict non-essential water usage.',
    recommendedAction: 'Snow-melt intake system activated. Water rationing advisory issued.',
    riskLevel: 'MODERATE',
  },
  interior_cold: {
    condition: (sensors) => {
      const lqTemp = sensors.livingQuarters?.lq_temp;
      return lqTemp && lqTemp < 16;
    },
    title: 'Living Quarters Cooling',
    cause: 'Interior temperature below comfortable range',
    correlatedSensors: ['lq_temp', 'lq_humidity', 'heat_a_temp'],
    recommendation: 'Check heating distribution. Inspect insulation integrity.',
    recommendedAction: 'Heating thermostat override: target 22°C.',
    riskLevel: 'MODERATE',
  },
};

// ── Walk dependency graph to find affected systems ──────────
function getAffectedSystems(buildingId) {
  const affected = [];
  const visited = new Set();

  function walk(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = DEPENDENCY_GRAPH[id];
    if (!node) return;
    node.feeds.forEach(feedId => {
      affected.push({
        id: feedId,
        name: BUILDINGS[feedId]?.name || feedId,
        module: BUILDINGS[feedId]?.module,
      });
      walk(feedId);
    });
  }

  walk(buildingId);
  return affected;
}

// ── Analyze current state and produce incidents ─────────────
let lastIncidents = new Map(); // stationId → Map(playbook → timestamp)

export function analyzeStation(stationId, sensors, alerts) {
  if (!lastIncidents.has(stationId)) {
    lastIncidents.set(stationId, new Map());
  }
  const stationIncidents = lastIncidents.get(stationId);
  const incidents = [];
  const now = Date.now();
  const COOLDOWN_MS = 30_000; // Don't re-trigger same playbook within 30s

  Object.entries(PLAYBOOKS).forEach(([playbookId, playbook]) => {
    const lastTriggered = stationIncidents.get(playbookId) || 0;
    if (now - lastTriggered < COOLDOWN_MS) return;

    if (playbook.condition(sensors, alerts)) {
      stationIncidents.set(playbookId, now);

      // Find which building is the root cause
      const rootBuilding = findRootBuilding(playbookId, sensors);
      const affected = rootBuilding ? getAffectedSystems(rootBuilding) : [];

      // Gather correlated sensor values
      const correlatedReadings = {};
      playbook.correlatedSensors.forEach(sensorId => {
        for (const [bId, bSensors] of Object.entries(sensors)) {
          if (bSensors[sensorId] !== undefined) {
            correlatedReadings[sensorId] = { building: bId, value: bSensors[sensorId] };
            break;
          }
        }
      });

      const incident = {
        id: `INC-${stationId.toUpperCase()}-${String(now).slice(-6)}`,
        stationId,
        playbookId,
        title: playbook.title,
        cause: playbook.cause,
        rootBuilding,
        rootBuildingName: BUILDINGS[rootBuilding]?.name || rootBuilding,
        affectedSystems: affected,
        affectedCount: affected.length,
        riskLevel: playbook.riskLevel,
        recommendation: playbook.recommendation,
        recommendedAction: playbook.recommendedAction,
        correlatedReadings,
        timestamp: now,
        status: 'active',
      };

      incidents.push(incident);

      // Log to event timeline
      addStationEvent(stationId, 'decision',
        `INCIDENT ${incident.id}: ${playbook.title} — ${playbook.riskLevel} risk — ${affected.length} dependent systems`,
        { incident }
      );
      addStationEvent(stationId, 'recommendation',
        `RECOMMENDED: ${playbook.recommendedAction}`,
        { incidentId: incident.id }
      );
    }
  });

  return incidents;
}

// ── Helper: determine root building from playbook ───────────
function findRootBuilding(playbookId, sensors) {
  const mapping = {
    generator_overheat: 'generator',
    generator_failure: 'generator',
    extreme_cold: 'lab',
    cold_warning: 'lab',
    high_wind: 'lab',
    comms_degraded: 'commsMast',
    heating_failure: 'heating',
    water_low: 'waterTank',
    interior_cold: 'livingQuarters',
  };
  return mapping[playbookId] || null;
}

// ── Get risk summary for a station ──────────────────────────
export function getRiskSummary(sensors, alerts) {
  const summary = {
    overall: 'NORMAL',
    criticalCount: 0,
    warningCount: 0,
    affectedSystemsCount: 0,
    activePlaybooks: [],
  };

  Object.entries(PLAYBOOKS).forEach(([id, playbook]) => {
    if (playbook.condition(sensors, alerts)) {
      summary.activePlaybooks.push({
        id,
        title: playbook.title,
        risk: playbook.riskLevel,
      });
      if (playbook.riskLevel === 'CRITICAL') summary.criticalCount++;
      else if (playbook.riskLevel === 'HIGH') summary.warningCount++;
    }
  });

  if (summary.criticalCount > 0) summary.overall = 'CRITICAL';
  else if (summary.warningCount > 0) summary.overall = 'WARNING';
  else if (summary.activePlaybooks.length > 0) summary.overall = 'ELEVATED';

  return summary;
}
