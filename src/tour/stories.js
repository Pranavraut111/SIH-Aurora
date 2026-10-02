/* ═══════════════════════════════════════════════════════════════
   Aurora — guided stories (judge mode). Loaded with the tour runner.

   A story is a tour (same runner, same look) whose steps can also act:
     station  the station that must be showing
     page     the module that must be showing
     before   async (ctx) => { … } run when the step is reached going forward:
              start the demo scenario, wait for the alert, open a building panel…
              ctx: { inject, reset, setLedger, waitFor(pred, ms), data(), openBuilding,
                     closeOverlays, click(selector), waitForEl(selector, ms) }
   Scenario stories use the shared public demo (one per station, 2 minutes, then it
   resets itself); if another visitor's scenario is running, the launcher in App.jsx
   joins it when it is the same one, or offers another story.
   ═══════════════════════════════════════════════════════════════ */

const tid = (id) => `[data-testid="${id}"]`;
const tour = (id) => `[data-tour="${id}"]`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const STORIES = {
  blizzard: {
    id: 'blizzard',
    title: 'Blizzard hits Maitri',
    summary: 'A storm hits the inland station: the weather turns, alerts fire, the AI flags it and recommends what to do.',
    station: 'maitri',
    scenario: 'blizzard',
    minutes: 2,
    steps: [
      {
        page: 'overview', station: 'maitri', targets: [tour('overview')],
        title: 'Blizzard hits Maitri',
        body: 'Maitri sits in the Schirmacher Oasis, about 100 km inland in Dronning Maud Land. In winter a blizzard can cut visibility to metres for days. We will run a simulated blizzard and watch how Aurora helps a team in India follow it. Next starts the scenario.',
      },
      {
        targets: [tid('demo-banner'), tid('alerts-pill')],
        before: async (c) => { await c.inject(); await c.waitFor((d) => Boolean(d.publicDemo?.maitri), 8000); },
        title: 'The scenario is running',
        body: ({ joined }) => `${joined ? 'Another visitor already started this blizzard, so we follow theirs. ' : ''}The banner is shown to everyone on the site: the scenario is shared, labelled Simulated, and resets itself after 2 minutes. Nothing real is touched; the simulator overrides the outside weather and the satellite signal.`,
      },
      {
        page: 'overview', targets: [tid('hud-wind'), '.overview-stage'],
        before: async (c) => { await c.waitFor((d) => num(d.sensors?.lab?.env_wind) > 60, 12000); },
        title: 'The weather turns',
        body: 'Wind climbs past storm strength and the temperature drops. These cards are the station\'s live telemetry; the sparkline shows the last half hour. On the ground, this is the moment outdoor work stops.',
      },
      {
        targets: [tid('alerts-pill')],
        before: async (c) => { await c.waitFor((d) => (d.activeAlerts || []).length > 0, 12000); },
        title: 'Alerts appear',
        body: 'The alert engine checks every sensor against its thresholds on every tick. Wind and the satellite link cross their limits, so alerts open here, with their severity, for anyone watching from India.',
      },
      {
        page: 'overview', targets: [tour('overview')],
        title: 'What the twin shows',
        body: 'The 3D view follows the data: blowing snow is driven by the live wind speed and direction, and the subsystems in alert are tinted and ringed in their status colour. Select a building, or use the Buildings list, for its readings.',
      },
      {
        page: 'ai', targets: [tid('ai-anomaly'), tid('kpi-anomaly')],
        title: 'The anomaly detector flags it',
        body: 'An Isolation Forest compares the readings with what the physics model expects. A storm this sudden makes the residuals jump, so the detector scores the current state as anomalous. It explains how far from normal, not why.',
      },
      {
        page: 'ai', targets: [tid('ai-explain'), tid('ai-answer')],
        title: 'The explanation',
        body: 'Here the situation is put into plain language for the people deciding what to do. With the language model available it writes the summary; without it, Aurora falls back to an offline summary and says so.',
      },
      {
        page: 'ai', targets: [tid('ai-decision'), tid('kpi-decision')],
        title: 'The recommended action',
        body: 'The decision engine turns the readings, the forecast and the alert state into a recommendation with its reasons: for example, suspend outdoor operations and secure the comms link. Rules, not guesses, so the team can check why.',
      },
      {
        page: 'overview', targets: [tid('demo-banner'), tour('overview')],
        before: async (c) => { await c.reset(); },
        title: 'Back to normal',
        body: 'The scenario has been reset: readings return to the model within a few ticks and the alerts clear once they are normal again. That is the loop Aurora closes for a remote station: see it, understand it, act on it.',
      },
    ],
  },

  generator: {
    id: 'generator',
    title: 'Generator failure at Bharati',
    summary: 'The coastal station loses its generator: see the alert, the cascade to heating and water, the building panel and the fuel impact.',
    station: 'bharati',
    scenario: 'generator_failure',
    minutes: 2,
    steps: [
      {
        page: 'overview', station: 'bharati', targets: [tour('overview')],
        title: 'Generator failure at Bharati',
        body: 'Bharati, on the Larsemann Hills coast, runs on diesel generators: power, heat and fresh water all depend on them. We will simulate a generator fault and follow its consequences. Next starts the scenario.',
      },
      {
        targets: [tid('alerts-pill'), tid('demo-banner')],
        before: async (c) => {
          await c.inject();
          await c.waitFor((d) => (d.activeAlerts || []).some((a) => a.buildingId === 'generator'), 14000);
        },
        title: 'The generator alert',
        body: ({ joined }) => `${joined ? 'Another visitor already started this fault, so we follow theirs. ' : ''}Output and engine speed fall and the coolant overheats: the generator goes critical. The scenario is shared, labelled Simulated, and resets itself after 2 minutes.`,
      },
      {
        page: 'infrastructure', station: 'bharati', targets: [tid('infra-dependency')],
        title: 'The cascade',
        body: 'The dependency graph follows the station configuration: the generator powers heating, water treatment, comms and the living quarters. When it fails, every building downstream is flagged as a cascade risk, before its own readings change.',
      },
      {
        targets: [tid('building-drawer')],
        before: async (c) => { await c.openBuilding('generator'); },
        title: 'The building panel',
        body: 'Every reading of the generator, each against its threshold, with a trend. The chips at the bottom open the buildings it depends on and the ones it feeds.',
      },
      {
        page: 'energy', station: 'bharati', targets: [tid('energy-kpis')],
        before: async (c) => { c.closeOverlays(); },
        title: 'Power and fuel',
        body: 'Generation and fuel burn on the energy page show the impact in kilowatts and litres per hour, and the fuel autonomy tells the team how long the station can hold out.',
      },
      {
        page: 'ai', targets: [tid('ai-decision'), tid('ai-explain')],
        title: 'The AI explanation',
        body: 'The decision engine and the explanation summarise the fault and what to do first: switch to the standby generator, shed non-essential load, protect heating and water.',
      },
      {
        page: 'overview', targets: [tour('overview')],
        before: async (c) => { await c.reset(); },
        title: 'Reset',
        body: 'The fault is cleared and the readings recover within a few ticks. In a real station the same view would show the standby generator taking over.',
      },
    ],
  },

  fuel: {
    id: 'fuel',
    title: 'Running low on fuel',
    summary: 'Edit the fuel ledger and test a fuel leak in what-if. Uses only your private sandbox: nobody else sees it.',
    station: 'maitri',
    scenario: null,
    minutes: 2,
    steps: [
      {
        page: 'logistics', station: 'maitri', targets: [tid('logistics-kpis')],
        title: 'Running low on fuel',
        body: 'Fuel is the lifeline of an Antarctic winter: resupply comes once a year by ship or aircraft. The logistics ledger is entered by the station team; autonomy is stock divided by daily use. This story changes only your own sandbox.',
      },
      {
        targets: [tid('ledger-row-maitri-fuel')],
        before: async (c) => { await c.setLedger('maitri', 'maitri-fuel', 0.06); },
        title: 'A lower reading',
        body: 'We have written a much lower diesel stock into your sandbox, as if a tank check came in low. Autonomy drops below the reorder level and the item is flagged. The row is tagged "Your sandbox": only you see it.',
      },
      {
        targets: [tid('kpi-low'), tid('logistics-kpis')],
        title: 'What it means',
        body: 'The supply summary now leads with the shortest supply. This is what a logistics officer in India watches to plan the next resupply flight or to cut consumption early.',
      },
      {
        page: 'simulation', station: 'maitri', targets: [tid('whatif-result'), tid('whatif-run')],
        before: async (c) => {
          await c.click(tid('scenario-fuel_leak'));
          await c.click(tid('whatif-run'));
          await c.waitForEl(tid('whatif-result'), 10000);
        },
        title: 'What if a tank leaks?',
        body: 'The what-if engine applies a fuel leak to the current state, using your sandbox stock. It shows the extra burn and the new autonomy, and lists its assumptions. It is a rule-based estimate, not a forecast, and it changes nothing.',
      },
      {
        page: 'logistics', targets: [tid('sandbox-reset'), tid('sandbox-notice')],
        title: 'Your sandbox',
        body: 'Everything you change as a visitor stays in your sandbox for an hour. "Reset my sandbox" puts you back on the shared station at any time.',
      },
    ],
  },
};

export const STORY_IDS = Object.keys(STORIES);

export function storySteps(id) {
  return STORIES[id]?.steps || [];
}
