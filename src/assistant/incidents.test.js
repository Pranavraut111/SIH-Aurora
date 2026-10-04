import { describe, expect, it } from 'vitest';
import PLAYBOOKS from '../../simulator/playbooks.json';
import { emptyState, observationFrom, observe, queue, selectPlaybook, stepsFor } from './incidents';
import { briefingText, formatDuration, nextStepText, resolvedSummary, updateText } from './briefing';

const books = PLAYBOOKS.playbooks;
const book = (id) => books.find((b) => b.id === id);
const genAlert = { id: 'g1', buildingId: 'generator', sensor: 'gen_power', level: 'critical', value: 25, unit: 'kW' };
const heatWarn = { id: 'h1', buildingId: 'heating', sensor: 'heat_a_temp', level: 'warning', value: 50, unit: '°C' };
const quiet = { station: 'bharati', alerts: [], scenario: null, linkUp: true, anomaly: null, risk: 'nominal', cascades: [] };

function run(observations) {
  let state = emptyState();
  const all = [];
  observations.forEach((o, i) => {
    const r = observe(state, { ...quiet, ...o }, books, 1000 * (i + 1));
    state = r.state;
    all.push(r.events);
  });
  return { state, events: all };
}

describe('playbook selection', () => {
  it('matches the backend order: scenario, sensors, causes, fallback', () => {
    expect(selectPlaybook(books, { scenario: 'co2_spike', sensors: ['gen_power'] }).id).toBe('co2_spike');
    expect(selectPlaybook(books, { sensors: ['comms_signal'] }).id).toBe('link_loss');
    expect(selectPlaybook(books, { sensors: ['env_wind'] }).id).toBe('blizzard');
    expect(selectPlaybook(books, { causes: ['bearing_wear'] }).id).toBe('generator_failure');
    expect(selectPlaybook(books, {}).id).toBe('anomaly');
  });
  it('every playbook is an example procedure with 4–6 steps', () => {
    expect(PLAYBOOKS.disclaimer).toBe('Example procedure, not an official NCPOR procedure.');
    books.forEach((b) => expect(b.steps.length).toBeGreaterThanOrEqual(4));
  });
});

describe('incident lifecycle', () => {
  it('a new critical alert starts an incident; quiet first load does not', () => {
    const { events, state } = run([{}, { alerts: [genAlert], scenario: 'generator_failure' }]);
    expect(events[0]).toEqual([]);
    expect(events[1]).toHaveLength(1);
    const inc = events[1][0].incident;
    expect(events[1][0].type).toBe('new');
    expect(inc).toMatchObject({ playbookId: 'generator_failure', severity: 'critical', atLoad: false, station: 'bharati' });
    expect(queue(state)).toHaveLength(1);
  });

  it('alerts already present on the first observation are flagged atLoad', () => {
    const { events } = run([{ alerts: [genAlert] }]);
    expect(events[0][0].incident.atLoad).toBe(true);
  });

  it('warnings alone are not an incident, but join one', () => {
    expect(run([{}, { alerts: [heatWarn] }]).events[1]).toEqual([]);
    const { state } = run([{}, { alerts: [genAlert, { ...heatWarn, sensor: 'gen_temp', buildingId: 'generator' }] }]);
    expect(queue(state)[0].alertIds).toEqual(['g1', 'h1']);
  });

  it('collects affected systems from the cascade chains and reports additions', () => {
    const cascades1 = [{ chain: ['generator', 'heating'], severity: 'critical' }];
    const cascades2 = [...cascades1, { chain: ['generator', 'heating', 'livingQuarters'], severity: 'warning' }];
    const { events } = run([{}, { alerts: [genAlert], cascades: cascades1 }, { alerts: [genAlert], cascades: cascades2 }]);
    expect(events[1][0].incident.affected).toEqual(['generator', 'heating']);
    expect(events[2][0]).toMatchObject({ type: 'update', added: ['livingQuarters'] });
  });

  it('the risk never drops below the playbook baseline while the engine lags', () => {
    const { events } = run([{}, { alerts: [genAlert], risk: 'low' }, { alerts: [genAlert], risk: 'nominal' }]);
    expect(events[1][0].incident).toMatchObject({ risk: 'high', baselineRisk: 'high', engineRisk: 'low', engineConfirmed: false });
    expect(events[2]).toEqual([]);                       // the engine sinking further changes nothing said
  });

  it('says so once the engine catches up with the baseline', () => {
    const { events } = run([{}, { alerts: [genAlert], risk: 'low' }, { alerts: [genAlert], risk: 'high' }]);
    expect(events[2][0]).toMatchObject({ type: 'update', confirmed: true, risk: null });
    expect(events[2][0].incident).toMatchObject({ risk: 'high', engineConfirmed: true });
    expect(updateText(events[2][0], book('generator_failure'))).toBe('The decision engine now confirms the risk at Bharati is high.');
  });

  it('an engine rating above the baseline escalates', () => {
    const { events } = run([{}, { alerts: [genAlert], risk: 'high' }, { alerts: [genAlert], risk: 'critical' }]);
    expect(events[2][0]).toMatchObject({ type: 'escalate', risk: 'critical', from: 'high' });
  });

  it('resolves after the trigger has been gone for two observations', () => {
    const { events, state } = run([{}, { alerts: [genAlert] }, {}, {}]);
    expect(events[2]).toEqual([]);
    expect(events[3][0].type).toBe('resolved');
    expect(queue(state)).toHaveLength(0);
  });

  it('queues simultaneous incidents by severity', () => {
    const co2Warn = { id: 'c1', buildingId: 'livingQuarters', sensor: 'lq_co2', level: 'critical' };
    const { state } = run([{}, { alerts: [co2Warn] }, { alerts: [co2Warn, genAlert], linkUp: false }]);
    expect(queue(state).map((i) => i.playbookId)).toEqual(['co2_spike', 'generator_failure', 'link_loss']);
  });

  it('a satellite link loss and a serious anomaly are incidents too', () => {
    expect(run([{}, { linkUp: false }]).events[1][0].incident.playbookId).toBe('link_loss');
    const an = { serious: true, causes: ['ventilation_degradation'], buildings: ['livingQuarters'] };
    expect(run([{}, { anomaly: an }]).events[1][0].incident).toMatchObject({ playbookId: 'co2_spike', severity: 'warning' });
  });

  it('marks sandbox-only incidents', () => {
    const sbx = { ...genAlert, id: 'SBX-1', sandboxThreshold: true };
    expect(run([{}, { alerts: [sbx] }]).events[1][0].incident.sandbox).toBe(true);
  });
});

describe('observationFrom', () => {
  it('reads alerts, scenario, link, serious anomaly and risk', () => {
    const sd = { activeAlerts: [genAlert], publicDemo: { bharati: { scenario: 'generator_failure' } }, link: { up: false }, dependencyAlerts: [] };
    const ctx = {
      station: { id: 'bharati' }, telemetry: [{ sensor: 'gen_rpm', building: 'generator' }],
      anomaly: { available: true, isAnomaly: true, maxResidualSigma: 40, residualAlarmSigma: 6, candidateCauses: [{ cause: 'x' }], evidence: [{ sensor: 'gen_rpm' }] },
      decision: { available: true, risk: { level: 'high' } },
    };
    expect(observationFrom('bharati', sd, ctx)).toMatchObject({
      scenario: 'generator_failure', linkUp: false, risk: 'high', anomaly: { serious: true, causes: ['x'], buildings: ['generator'] },
    });
    expect(observationFrom('maitri', sd, ctx).risk).toBeNull();      // context of another station is ignored
  });
});

describe('risk floor in briefings', () => {
  it.each([['low'], ['nominal'], [null], ['moderate']])('a generator failure is never briefed below High (engine: %s)', (engine) => {
    const { events } = run([{}, { alerts: [genAlert], risk: engine }]);
    const text = briefingText(events[1][0].incident, book('generator_failure'));
    expect(text).toContain('Risk is high.');
    expect(text).not.toMatch(/Risk is (low|nominal|moderate)/);
  });
  it('every playbook has a baseline and failure types start at least at moderate', () => {
    books.forEach((b) => expect(['nominal', 'low', 'moderate', 'high', 'critical']).toContain(b.baselineRisk));
    ['generator_failure', 'heating_failure', 'co2_spike', 'blizzard'].forEach((id) => expect(book(id).baselineRisk).toBe('high'));
  });
});

describe('briefings', () => {
  const inc = {
    station: 'bharati', playbookId: 'generator_failure', sources: ['generator'], affected: ['generator', 'heating', 'heatingB'],
    everAffected: ['generator', 'heating', 'heatingB'], risk: 'high', done: [], startedAt: 0, resolvedAt: 130000, sandbox: false,
  };
  it('speaks the spec-style briefing', () => {
    expect(briefingText(inc, book('generator_failure'), { navigatedTo: 'Energy grid' })).toBe(
      'Generator failure detected at Bharati. Heating Zone A and Heating Zone B may be affected. Risk is high. '
      + 'First, verify backup power. Next, notify the station leader. Then, check the affected electrical loads. '
      + "I've opened the Energy grid and highlighted the affected systems.");
  });
  it('skips ticked steps, reads the next one, summarises', () => {
    const ticked = { ...inc, done: [0] };
    expect(briefingText(ticked, book('generator_failure'))).toContain('First, notify the station leader.');
    expect(nextStepText(ticked, book('generator_failure'))).toMatch(/^Step 2 of 6: Notify the station leader and log the event/);
    expect(resolvedSummary(ticked, book('generator_failure')).text).toBe(
      'Generator failure at Bharati resolved after 2 minutes 10 seconds. Affected: Generator Shed, Heating Zone A and Heating Zone B. 1 of 6 steps completed.');
  });
  it('update texts', () => {
    expect(updateText({ type: 'escalate', incident: inc, risk: 'high', from: 'moderate', added: [] }, book('generator_failure')))
      .toBe('Risk at Bharati escalated from moderate to high.');
    expect(updateText({ type: 'update', incident: inc, added: ['livingQuarters'] }, book('generator_failure')))
      .toBe('Living Quarters is now affected.');
    expect(formatDuration(61000)).toBe('1 minute 1 second');
  });
});

describe('notify the station leader early', () => {
  it.each(['generator_failure', 'heating_failure', 'co2_spike', 'blizzard'])('%s: the briefing says it second', (id) => {
    const steps = book(id).steps;
    expect(steps[1].say).toBe('notify the station leader');
    const inc = { station: 'maitri', playbookId: id, sources: [], affected: [], risk: 'high', done: [] };
    expect(briefingText(inc, book(id))).toContain('Next, notify the station leader.');
  });
  it('the generator playbook still informs the mainland as its last step', () => {
    const steps = book('generator_failure').steps;
    expect(steps.at(-1).say).toBe('inform the mainland if power is not restored');
  });
});

describe('water_crisis step 1 follows the alerting sensor', () => {
  const water = book('water_crisis');
  const lvl = { id: 'w1', buildingId: 'waterTreatment', sensor: 'water_level', level: 'critical', value: 12, unit: '%' };
  const ph = { id: 'w2', buildingId: 'waterTreatment', sensor: 'water_ph', level: 'critical', value: 9.4, unit: 'pH' };
  it('only the level is low: conserve and check the tank by hand', () => {
    const { events } = run([{}, { alerts: [lvl] }]);
    const inc = events[1][0].incident;
    expect(stepsFor(water, inc)[0]).toEqual({ do: 'Start conserving water.', say: 'start conserving water' });
    expect(briefingText(inc, water)).toContain('First, start conserving water.');
  });
  it.each([['water_ph'], ['water_temp']])('a quality sensor (%s) is out of range: restrict drinking water', (sensor) => {
    const { events } = run([{}, { alerts: [{ ...ph, sensor }] }]);
    expect(stepsFor(water, events[1][0].incident)[0].do).toBe('Restrict drinking water use until the water quality has been checked by hand.');
  });
  it('level and quality together: quality wins', () => {
    const { events } = run([{}, { alerts: [lvl, ph] }]);
    expect(stepsFor(water, events[1][0].incident)[0].say).toBe('restrict drinking water use');
  });
  it('no alert sensor known: the conservative text', () => {
    expect(stepsFor(water, { sensors: [] })[0].say).toBe('restrict drinking water use');
  });
  it('a quality alert joining a level incident switches step 1 and says so; it stays switched', () => {
    const { events, state } = run([{}, { alerts: [lvl] }, { alerts: [lvl, { ...ph, level: 'warning' }] }, { alerts: [lvl] }]);
    const ev = events[2][0];
    expect(ev).toMatchObject({ type: 'update', changedSteps: [0] });
    expect(updateText(ev, water)).toBe('Step 1 is now: restrict drinking water use.');
    expect(events[3]).toEqual([]);
    expect(stepsFor(water, queue(state)[0])[0].say).toBe('restrict drinking water use');
  });
});

describe('low_fuel risk escalation', () => {
  const fuelAlert = { id: 'f1', buildingId: 'storage', sensor: 'store_fuel', level: 'critical', value: 20, unit: 'kL' };
  const fuel = (value) => ({ fuelAutonomyDays: { value, unit: 'days', escalateBelow: 30 } });
  it('above the threshold the baseline (moderate) stands', () => {
    const { events } = run([{}, { alerts: [fuelAlert], risk: 'low', metrics: fuel(45) }]);
    expect(events[1][0].incident).toMatchObject({ risk: 'moderate', floorRisk: 'moderate', escalation: null });
  });
  it('below the threshold the incident starts at high and the briefing says why', () => {
    const { events } = run([{}, { alerts: [fuelAlert], risk: 'low', metrics: fuel(21) }]);
    const inc = events[1][0].incident;
    expect(inc).toMatchObject({ risk: 'high', baselineRisk: 'moderate', floorRisk: 'high', engineConfirmed: false });
    expect(briefingText(inc, book('low_fuel'))).toContain('Risk is high. Fuel autonomy is 21 days, below the 30-day planning threshold.');
  });
  it('crossing the threshold mid-incident escalates, and it does not flap back', () => {
    const { events, state } = run([{}, { alerts: [fuelAlert], risk: 'low', metrics: fuel(31) },
      { alerts: [fuelAlert], risk: 'low', metrics: fuel(29) }, { alerts: [fuelAlert], risk: 'low', metrics: fuel(31) }]);
    const ev = events[2][0];
    expect(ev).toMatchObject({ type: 'escalate', risk: 'high', from: 'moderate' });
    expect(updateText(ev, book('low_fuel'))).toBe('Fuel autonomy is 29 days, below the 30-day planning threshold. Risk at Bharati raised from moderate to high.');
    expect(events[3]).toEqual([]);
    expect(queue(state)[0].risk).toBe('high');
  });
  it('the engine confirms against the raised floor; a critical engine rating still wins', () => {
    expect(run([{}, { alerts: [fuelAlert], risk: 'high', metrics: fuel(10) }]).events[1][0].incident.engineConfirmed).toBe(true);
    expect(run([{}, { alerts: [fuelAlert], risk: 'critical', metrics: fuel(10) }]).events[1][0].incident.risk).toBe('critical');
  });
  it('other playbooks ignore the metric', () => {
    const { events } = run([{}, { alerts: [genAlert], risk: 'low', metrics: fuel(5) }]);
    expect(events[1][0].incident).toMatchObject({ risk: 'high', escalation: null });
  });
  it('observationFrom passes the context metrics of the same station only', () => {
    const ctx = { station: { id: 'bharati' }, derived: fuel(12) };
    expect(observationFrom('bharati', {}, ctx).metrics.fuelAutonomyDays.value).toBe(12);
    expect(observationFrom('maitri', {}, ctx).metrics).toEqual({});
  });
});
