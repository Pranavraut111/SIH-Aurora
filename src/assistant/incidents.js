/* ═══════════════════════════════════════════════════════════════
   Aurora assistant — incident mode, the pure part (no React, no timers).

   observe(state, observation, playbooks, now) → {state, events}

   An observation is one station's current picture: its active alerts (shared, or
   the visitor's own sandbox alerts), the running demo scenario, the satellite
   link, the anomaly detector and the decision engine's risk, and the cascades.

   Incidents start on a NEW critical alert, a satellite link loss, or a serious
   anomaly (detector flag + a residual over its alarm gate). Each is matched to a
   playbook (scenario first, then alert sensors, then anomaly causes — the same
   order as simulator/assistant.py). While it runs it collects affected systems
   (alert buildings + the backend's cascade chains) and follows the risk; it is
   resolved once its trigger has been absent for RESOLVE_AFTER observations.

   Risk: max(the playbook's floor, the decision engine's level). The floor is its
   baselineRisk, raised by the playbook's `riskEscalation` once the named context metric
   falls below its configured threshold (low fuel: fuel autonomy below
   station_config.json's planning threshold → high); a raised floor stays raised for the
   rest of the incident. The engine can lag the alerts by a tick or two, so an incident
   never states less than the floor for its failure type; once the engine reaches the
   floor the incident is marked `engineConfirmed` (an update says so), and a higher
   engine rating escalates it.

   Steps: a step may have `variants`, chosen by the alert sensors seen during the
   incident (stepsFor). If the chosen variants change, an update names the steps.

   Events: new | update | escalate | resolved. Incidents already present on the
   first observation of a station are flagged `atLoad` (shown, never announced).
   ═══════════════════════════════════════════════════════════════ */

export const RESOLVE_AFTER = 2;
const SEVERITY_RANK = { critical: 2, warning: 1 };
export const RISK_RANK = { nominal: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const rank = (r) => (r == null ? -1 : RISK_RANK[r] ?? -1);

/** The risk an incident may state: never below its playbook's baseline for the failure type,
 *  raised by the decision engine when the engine rates it higher. */
export function effectiveRisk(baseline, engine) {
  return rank(engine) > rank(baseline) ? engine : (baseline || engine || null);
}

export const emptyState = () => ({ incidents: {}, seen: {} });

/** The variant chosen for each step: index into `variants`, or -1 for the step's own text. */
function variantChoice(book, sensors) {
  return (book?.steps || []).map((s) => (s.variants || []).findIndex((v) => v.whenSensors.some((x) => sensors.includes(x))));
}

/** The playbook's steps for this incident: each step's first variant whose `whenSensors`
 *  includes a sensor that has alerted during the incident, else the step's own text. */
export function stepsFor(book, inc) {
  const choice = variantChoice(book, inc?.sensors || []);
  return (book?.steps || []).map((s, i) => {
    const v = choice[i] >= 0 ? s.variants[choice[i]] : s;
    return { do: v.do, say: v.say };
  });
}

/** The playbook's riskEscalation when its metric is below the threshold now, else null. */
function escalationNow(book, metrics) {
  const rule = book?.riskEscalation;
  const m = rule && metrics?.[rule.metric];
  if (!m || typeof m.value !== 'number' || typeof m.escalateBelow !== 'number' || !(m.value < m.escalateBelow)) return null;
  return { metric: rule.metric, risk: rule.risk, value: m.value, below: m.escalateBelow };
}

/** The playbook for a scenario / alert sensors / anomaly causes (mirrors assistant.select_playbook). */
export function selectPlaybook(books, { scenario = null, sensors = [], causes = [] } = {}) {
  if (scenario) {
    const p = books.find((b) => b.match.scenarios.includes(scenario));
    if (p) return p;
  }
  if (sensors.length) {
    const p = books.find((b) => sensors.some((s) => b.match.sensors.includes(s)));
    if (p) return p;
  }
  if (causes.length) {
    const p = books.find((b) => causes.some((c) => b.match.anomalyCauses.includes(c)));
    if (p) return p;
  }
  return books.find((b) => b.id === 'anomaly');
}

const alertBuilding = (a) => a.buildingId || a.building;

/** Group what is wrong right now into {playbookId: {severity, alerts, buildings, kind}}. */
function triggers(obs, books) {
  const groups = {};
  const scenarioBook = obs.scenario ? books.find((b) => b.match.scenarios.includes(obs.scenario)) : null;
  const bookFor = (sensor) => (scenarioBook?.match.sensors.includes(sensor) ? scenarioBook : selectPlaybook(books, { sensors: [sensor] }));
  const add = (book, severity, kind) => {
    const g = groups[book.id] || (groups[book.id] = { severity, alerts: [], buildings: new Set(), kind });
    if ((SEVERITY_RANK[severity] || 0) > (SEVERITY_RANK[g.severity] || 0)) g.severity = severity;
    return g;
  };
  const alerts = obs.alerts || [];
  alerts.filter((a) => a.level === 'critical').forEach((a) => {
    const g = add(bookFor(a.sensor), 'critical', 'alert');
    g.alerts.push(a);
    g.buildings.add(alertBuilding(a));
  });
  // Related warnings join an incident that already exists; on their own they are not one.
  alerts.filter((a) => a.level !== 'critical').forEach((a) => {
    const g = groups[bookFor(a.sensor).id];
    if (g) { g.alerts.push(a); g.buildings.add(alertBuilding(a)); }
  });
  if (obs.linkUp === false) {
    const g = add(books.find((b) => b.id === 'link_loss'), 'warning', 'link');
    g.buildings.add('commsMast');
  }
  const an = obs.anomaly;
  if (an?.serious) {
    const book = selectPlaybook(books, { causes: an.causes || [] });
    if (!groups[book.id]) {
      const g = add(book, 'warning', 'anomaly');
      (an.buildings || []).forEach((b) => g.buildings.add(b));
    }
  }
  return groups;
}

/** Buildings affected through the backend's cascade chains that start at one of `sources`. */
function cascadeAffected(cascades, sources) {
  const out = new Set();
  (cascades || []).forEach((c) => {
    const chain = c.chain?.length ? c.chain : [c.sourceBuilding, c.affectedBuilding];
    if (sources.has(chain[0])) chain.slice(1).forEach((b) => out.add(b));
  });
  return out;
}

export function observe(state, obs, books, now) {
  const events = [];
  const incidents = { ...state.incidents };
  const first = !state.seen[obs.station];
  const groups = triggers(obs, books);
  const engine = obs.risk || null;

  Object.entries(groups).forEach(([pid, g]) => {
    const key = `${obs.station}:${pid}`;
    const sources = g.buildings;
    const affected = [...new Set([...sources, ...cascadeAffected(obs.cascades, sources)])];
    const cur = incidents[key];
    const book = books.find((b) => b.id === pid);
    const alertSensors = g.alerts.map((a) => a.sensor).filter(Boolean);
    if (!cur || cur.status === 'resolved') {
      const baseline = book?.baselineRisk || null;
      const escalation = escalationNow(book, obs.metrics);
      const floor = escalation ? effectiveRisk(baseline, escalation.risk) : baseline;
      const risk = effectiveRisk(floor, engine);
      const inc = {
        id: `${key}:${now}`, key, station: obs.station, playbookId: pid, kind: g.kind, severity: g.severity,
        status: 'active', startedAt: now, atLoad: first, alertIds: g.alerts.map((a) => a.id),
        sources: [...sources], affected, everAffected: affected, risk, peakRisk: risk,
        baselineRisk: baseline, floorRisk: floor, escalation, engineRisk: engine,
        engineConfirmed: rank(engine) >= rank(floor) && engine != null, sensors: [...new Set(alertSensors)],
        sandbox: g.alerts.length > 0 && g.alerts.every((a) => a.sandboxThreshold || a.sandbox),
        scenario: obs.scenario || null, done: [], clear: 0, updatedAt: now,
      };
      incidents[key] = inc;
      events.push({ type: 'new', incident: inc });
      return;
    }
    const added = affected.filter((b) => !cur.everAffected.includes(b));
    const escalated = (SEVERITY_RANK[g.severity] || 0) > (SEVERITY_RANK[cur.severity] || 0);
    const eng = engine || cur.engineRisk;
    const newEscalation = cur.escalation ? null : escalationNow(book, obs.metrics);
    const escalation = cur.escalation || newEscalation;
    const floor = newEscalation ? effectiveRisk(cur.floorRisk, newEscalation.risk) : cur.floorRisk;
    const risk = effectiveRisk(floor, eng);
    const riskUp = rank(risk) > rank(cur.risk);
    const riskChanged = risk !== cur.risk;
    const confirmed = !cur.engineConfirmed && eng != null && rank(eng) >= rank(floor);
    const sensors = [...new Set([...cur.sensors, ...alertSensors])];
    const before = variantChoice(book, cur.sensors);
    const changedSteps = variantChoice(book, sensors).map((c, i) => (c !== before[i] ? i : -1)).filter((i) => i >= 0);
    const next = {
      ...cur, severity: escalated ? g.severity : cur.severity, sources: [...sources], affected, sensors, floorRisk: floor, escalation,
      everAffected: [...cur.everAffected, ...added], alertIds: [...new Set([...cur.alertIds, ...g.alerts.map((a) => a.id)])],
      risk, engineRisk: eng, engineConfirmed: cur.engineConfirmed || confirmed, clear: 0,
      peakRisk: rank(risk) > rank(cur.peakRisk) ? risk : cur.peakRisk,
    };
    if (added.length || escalated || riskChanged || confirmed || changedSteps.length) next.updatedAt = now;
    incidents[key] = next;
    const detail = { incident: next, added, from: cur.risk, confirmed, escalation: newEscalation, changedSteps };
    if (escalated || (riskUp && cur.risk != null)) events.push({ type: 'escalate', ...detail, risk: riskUp ? risk : null });
    else if (added.length || riskChanged || confirmed || changedSteps.length) {
      events.push({ type: 'update', ...detail, risk: riskChanged ? risk : null });
    }
  });

  Object.values(incidents).forEach((inc) => {
    if (inc.station !== obs.station || inc.status !== 'active' || groups[inc.playbookId]) return;
    const clear = inc.clear + 1;
    if (clear < RESOLVE_AFTER) { incidents[inc.key] = { ...inc, clear }; return; }
    const done = { ...inc, clear, status: 'resolved', resolvedAt: now, updatedAt: now };
    incidents[inc.key] = done;
    events.push({ type: 'resolved', incident: done });
  });

  return { state: { incidents, seen: { ...state.seen, [obs.station]: true } }, events };
}

/** Active incidents, most severe first, then oldest first. */
export function queue(state) {
  return Object.values(state.incidents).filter((i) => i.status === 'active' && !i.dismissed)
    .sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (a.startedAt - b.startedAt));
}

/** True when incident `a` ranks above `b`: a higher alert severity, or the same severity and a higher risk. */
export function outranks(a, b) {
  const bySeverity = (SEVERITY_RANK[a.severity] || 0) - (SEVERITY_RANK[b.severity] || 0);
  return bySeverity > 0 || (bySeverity === 0 && rank(a.risk) > rank(b.risk));
}

/** Where the visitor's own NEW incident goes: it takes the card and the one shown moves to the
 *  queue, unless the one shown outranks it; then it waits in the queue behind that one.
 *  → {focus: key for the card, behind: the incident it is queued behind, or null} */
export function placeOwnIncident(shown, incoming) {
  if (!shown || shown.key === incoming.key || shown.status !== 'active' || shown.dismissed) return { focus: incoming.key, behind: null };
  return outranks(shown, incoming) ? { focus: shown.key, behind: shown } : { focus: incoming.key, behind: null };
}

/** The observation for one station from the telemetry snapshot + the assistant context. */
export function observationFrom(station, stationData, ctx) {
  const an = ctx?.station?.id === station ? ctx.anomaly : null;
  const serious = Boolean(an?.available && an.isAnomaly && an.maxResidualSigma != null && an.residualAlarmSigma != null
    && an.maxResidualSigma >= an.residualAlarmSigma);
  const tele = ctx?.telemetry || [];
  return {
    station,
    alerts: stationData?.activeAlerts || [],
    scenario: stationData?.publicDemo?.[station]?.scenario || stationData?.provenance?.activeScenario || null,
    linkUp: stationData?.link ? stationData.link.up !== false : true,
    anomaly: serious ? {
      serious, causes: (an.candidateCauses || []).map((c) => c.cause),
      buildings: [...new Set((an.evidence || []).map((e) => tele.find((r) => r.sensor === e.sensor)?.building).filter(Boolean))],
    } : null,
    risk: ctx?.station?.id === station && ctx.decision?.available ? ctx.decision.risk?.level || null : null,
    // Context metrics a playbook's riskEscalation can name ({value, escalateBelow}).
    metrics: ctx?.station?.id === station ? ctx.derived || {} : {},
    cascades: stationData?.dependencyAlerts || [],
  };
}
