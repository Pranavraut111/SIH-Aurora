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
    summary: 'A storm hits the inland station: the weather turns, alerts go off, and the AI spots it and suggests what to do.',
    station: 'maitri',
    scenario: 'blizzard',
    minutes: 2,
    steps: [
      {
        page: 'overview', station: 'maitri', targets: [tour('overview')],
        title: 'Blizzard hits Maitri',
        body: 'Maitri is about 100 km inland, where a winter blizzard can last for days. Press Next to start a simulated blizzard and see how Aurora helps a team in India follow it.',
      },
      {
        targets: [tid('demo-banner'), tid('alerts-pill')],
        before: async (c) => { await c.inject(); await c.waitFor((d) => Boolean(d.publicDemo?.maitri), 8000); },
        title: 'The scenario is running',
        body: ({ joined }) => (joined
          ? 'Another visitor already started this blizzard, so you are following theirs. Everyone on the site sees this banner, and it ends by itself after 2 minutes.'
          : 'The blizzard is now running. It is simulated, everyone on the site sees this banner, and it ends by itself after 2 minutes.'),
      },
      {
        page: 'overview', targets: [tid('hud-wind'), '.overview-stage'],
        before: async (c) => { await c.waitFor((d) => num(d.sensors?.lab?.env_wind) > 60, 12000); },
        title: 'The weather turns',
        body: 'The wind rises to storm strength and the temperature falls. These cards show the station\'s live readings; on the ground, this is when outdoor work stops.',
      },
      {
        targets: [tid('alerts-pill')],
        before: async (c) => { await c.waitFor((d) => (d.activeAlerts || []).length > 0, 12000); },
        title: 'Alerts appear',
        body: 'Every reading is checked against its safe limits every two seconds. The wind and the satellite link are now out of range, so alerts appear here for anyone watching.',
      },
      {
        page: 'overview', targets: [tour('overview')],
        title: 'What the twin shows',
        body: 'The 3D view follows the data: the blowing snow follows the live wind, and buildings with an alert turn the alert\'s colour. Select a building, or use the Buildings list, to see its readings.',
      },
      {
        page: 'ai', targets: [tid('ai-anomaly'), tid('kpi-anomaly')],
        title: 'The anomaly detector flags it',
        body: 'A machine-learning detector compares the readings with what our station model expects. A storm this sudden is far from normal, so it flags the station as unusual.',
      },
      {
        page: 'ai', targets: [tid('ai-explain'), tid('ai-answer')],
        title: 'The explanation',
        body: 'Here an AI language model sums up the situation in plain words for the people who must decide. If it is unavailable, Aurora shows a built-in summary instead and says so.',
      },
      {
        page: 'ai', targets: [tid('ai-decision'), tid('kpi-decision')],
        title: 'The recommended action',
        body: 'The decision engine turns the readings, the forecast and the alerts into advice with its reasons, such as stopping outdoor work. It follows fixed rules, so anyone can check why.',
      },
      {
        page: 'overview', targets: [tid('demo-banner'), tour('overview')],
        before: async (c) => { await c.reset(); },
        title: 'Back to normal',
        body: 'We have ended the blizzard: the readings recover within a minute and the alerts clear. See it, understand it, act on it: that is what Aurora does for a remote station.',
      },
    ],
  },

  generator: {
    id: 'generator',
    title: 'Generator failure at Bharati',
    summary: 'The coastal station loses its generator: see the alert, the knock-on effect on heating and water, and the fuel impact.',
    station: 'bharati',
    scenario: 'generator_failure',
    minutes: 2,
    steps: [
      {
        page: 'overview', station: 'bharati', targets: [tour('overview')],
        title: 'Generator failure at Bharati',
        body: 'Bharati, on the coast, runs on diesel generators: power, heat and fresh water all depend on them. Press Next to simulate a generator fault and follow what it affects.',
      },
      {
        targets: [tid('alerts-pill'), tid('demo-banner')],
        before: async (c) => {
          await c.inject();
          await c.waitFor((d) => (d.activeAlerts || []).some((a) => a.buildingId === 'generator'), 14000);
        },
        title: 'The generator alert',
        body: ({ joined }) => (joined
          ? 'Another visitor already started this fault, so you are following theirs. The generator\'s output falls and it overheats, so its alert turns critical.'
          : 'The generator\'s output falls and it overheats, so its alert turns critical. The fault is simulated, everyone sees it, and it ends by itself after 2 minutes.'),
      },
      {
        page: 'infrastructure', station: 'bharati', targets: [tid('infra-dependency')],
        title: 'The cascade',
        body: 'This map shows which buildings rely on which. Everything the generator powers, such as heating, water and the living quarters, is flagged as at risk before its own readings change.',
      },
      {
        targets: [tid('building-drawer')],
        before: async (c) => { await c.openBuilding('generator'); },
        title: 'The building panel',
        body: 'Every reading of the generator, each compared with its safe limit. The links at the bottom open the buildings it relies on and the ones it supplies.',
      },
      {
        page: 'energy', station: 'bharati', targets: [tid('energy-kpis')],
        before: async (c) => { c.closeOverlays(); },
        title: 'Power and fuel',
        body: 'The energy page shows the impact: how much power is lost and how fast fuel is used. The fuel autonomy tells the team how long the station can last.',
      },
      {
        page: 'ai', targets: [tid('ai-decision'), tid('ai-explain')],
        title: 'The AI explanation',
        body: 'The advice and the AI summary say what to do first, for example: switch to the standby generator, cut non-essential power, and protect heating and water.',
      },
      {
        page: 'overview', targets: [tour('overview')],
        before: async (c) => { await c.reset(); },
        title: 'Reset',
        body: 'We have cleared the fault and the readings recover within a minute. At a real station, this view would show the standby generator taking over.',
      },
    ],
  },

  fuel: {
    id: 'fuel',
    title: 'Running low on fuel',
    summary: 'Lower the fuel stock and test a fuel leak. Uses only your private sandbox: nobody else sees it.',
    station: 'maitri',
    scenario: null,
    minutes: 2,
    steps: [
      {
        page: 'logistics', station: 'maitri', targets: [tid('logistics-kpis')],
        title: 'Running low on fuel',
        body: 'Fuel is the lifeline of an Antarctic winter, and new supplies arrive about once a year. This page lists the stock the station team enters; this story changes only your private copy.',
      },
      {
        targets: [tid('ledger-row-maitri-fuel')],
        before: async (c) => { await c.setLedger('maitri', 'maitri-fuel', 0.06); },
        title: 'A lower reading',
        body: 'We entered a much lower diesel stock for you, as if a tank check came in low. The days of fuel left drop below the reorder level, and the row is tagged "Your sandbox".',
      },
      {
        targets: [tid('kpi-low'), tid('logistics-kpis')],
        title: 'What it means',
        body: 'The summary now puts the shortest supply first. A logistics officer in India watches this to plan the next resupply or to cut use early.',
      },
      {
        page: 'simulation', station: 'maitri', targets: [tid('whatif-result'), tid('whatif-run')],
        before: async (c) => {
          await c.click(tid('scenario-fuel_leak'));
          await c.click(tid('whatif-run'));
          await c.waitForEl(tid('whatif-result'), 10000);
        },
        title: 'What if a tank leaks?',
        body: 'The what-if tool applies a fuel leak to your stock and shows how much sooner the fuel runs out. It is a rule-based estimate and changes nothing.',
      },
      {
        page: 'logistics', targets: [tid('sandbox-reset'), tid('sandbox-notice')],
        title: 'Your sandbox',
        body: 'Your changes stay private for an hour. "Reset my sandbox" takes you back to the shared station at any time.',
      },
    ],
  },

  linkloss: {
    id: 'linkloss',
    title: 'Satellite link drops at Bharati',
    summary: 'The link to India goes down: the station keeps working and recording, then everything syncs when the link returns.',
    station: 'bharati',
    scenario: 'link_loss',
    minutes: 2,
    steps: [
      {
        page: 'overview', station: 'bharati', targets: [tour('overview')],
        title: 'Satellite link drops at Bharati',
        body: 'Bharati talks to India over a satellite link that can drop for hours in bad weather. Press Next to cut it (simulated) and see what happens to the data.',
      },
      {
        targets: [tid('link-banner'), tid('demo-banner')],
        before: async (c) => { await c.inject(); await c.waitFor((d) => d.link && !d.link.up, 8000); },
        title: 'The link is down',
        body: ({ joined }) => (joined
          ? 'Another visitor already cut this link, so you are following theirs. The dashboard keeps the last data it received and says when that was.'
          : 'The dashboard keeps the last data it received, and says when that was. Every figure is greyed and marked stale.'),
      },
      {
        targets: [tid('link-buffered'), tid('link-banner')],
        before: async (c) => { await c.waitFor((d) => (d.link?.bufferedReadings || 0) >= 5, 15000); },
        title: 'The station keeps working',
        body: 'Power, heating and water carry on, and the station records every reading on site. This count, and its size in KB, grows every two seconds.',
      },
      {
        targets: [tid('link-buffered'), tid('link-banner')],
        before: async (c) => { await c.waitFor((d) => (d.link?.bufferedReadings || 0) >= 12, 20000); },
        title: 'Something happens on site',
        body: 'Meanwhile the CO₂ level in the living quarters rises past its limit (part of this demo). The readings that show it are on site, but nobody in India can see them yet.',
      },
      {
        targets: [tid('alerts-pill')],
        before: async (c) => {
          await c.reset();
          await c.waitFor((d) => d.link?.up && d.link?.lastSync && Date.now() - d.link.lastSync.at < 60000, 15000);
        },
        title: 'The link returns',
        body: ({ story }) => {
          const m = story?.data?.()?.link?.lastSync?.message;
          return `${m ? `${m} ` : ''}Everything recorded is sent in order, and the CO₂ alert appears with the time it really happened.`;
        },
      },
      {
        page: 'overview', targets: [tid('hud-kpis'), tour('overview')],
        title: 'No hole in the data',
        body: 'The charts fill the gap with the readings recorded during the outage. This is the store-and-forward pattern a real station computer would use; the readings themselves come from our model.',
      },
    ],
  },
};

export const STORY_IDS = Object.keys(STORIES);

export function storySteps(id) {
  return STORIES[id]?.steps || [];
}
