/* Aurora — end-to-end smoke test against the real stack (backend + simulator + Vite).
 *
 * What it proves:
 *   1. The overview renders with live telemetry and a declared data source.
 *   2. Every sidebar module opens — no console errors, no failed requests anywhere.
 *   3. Injecting generator_failure on bharati surfaces a bharati alert in the UI
 *      (the alert engine runs in the backend tick, so this exercises the whole path).
 *
 * Runs with software WebGL (see playwright.config.js) so the three.js twin renders
 * rather than silently taking the 2D fallback.
 */
import { expect, test } from '@playwright/test';

const API = `http://127.0.0.1:${process.env.API_PORT || '8080'}`;

const MODULES = [
  'Mission Overview',
  'Weather Observations',
  'Infrastructure',
  'Energy Grid',
  'Logistics & Supply',
  'Remote C&C',
  'What-If Sim',
  'AI Diagnostics',
  'Station Reports',
  'System Admin',
];

/** Vite's dev client and source maps are not the app under test. */
const IGNORED_URL = /\/@vite\/|\/@react-refresh|\.map$|favicon/;

/** Collect every console error and failed request for the whole page lifetime. */
function watchForProblems(page) {
  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message}`));
  page.on('requestfailed', (req) => {
    if (!IGNORED_URL.test(req.url())) {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !IGNORED_URL.test(res.url())) {
      failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });

  return { consoleErrors, failedRequests };
}

async function openStation(page, stationId) {
  await page.locator('.station-selector-btn').click();
  await page.locator('.station-option').filter({ hasText: stationId === 'maitri' ? 'Maitri' : 'Bharati' }).click();
  await expect(page.locator('.station-dropdown')).toHaveCount(0);
}

test.beforeAll(async ({ request }) => {
  // The whole stack must be up before the browser opens. The backend starts first and
  // caches its simulator probe for 5 s, so poll rather than asserting on the first read.
  await expect
    .poll(async () => {
      const res = await request.get(`${API}/api/health`);
      if (!res.ok()) return null;
      const body = await res.json();
      return body.db.ok && body.simulator.reachable;
    }, { timeout: 30_000, message: 'backend never reported the simulator as reachable' })
    .toBe(true);
});

test('the overview renders live telemetry with a declared data source', async ({ page }) => {
  const { consoleErrors, failedRequests } = watchForProblems(page);

  await page.goto('/');
  await expect(page.locator('.aurora-app')).toBeVisible();
  await expect(page.locator('.overview-stage')).toBeVisible();

  // Telemetry has arrived and the UI says where it came from (CLAUDE.md: provenance).
  const badge = page.getByTestId('data-source-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('data-source', /simulator|physics-fallback|browser-demo/);

  // The 3D twin renders under software WebGL, so the 2D fallback must not be showing.
  await expect(page.getByTestId('station-2d-fallback')).toHaveCount(0);
  await expect(page.locator('.scene-container canvas')).toBeVisible();

  expect(consoleErrors, 'console errors on the overview').toEqual([]);
  expect(failedRequests, 'failed requests on the overview').toEqual([]);
});

test('every module opens cleanly', async ({ page }) => {
  const { consoleErrors, failedRequests } = watchForProblems(page);

  await page.goto('/');
  await expect(page.locator('.overview-stage')).toBeVisible();

  for (const label of MODULES) {
    await page.locator('.sidebar-item', { hasText: label }).click();
    const item = page.locator('.sidebar-item.active', { hasText: label });
    await expect(item, `${label} did not become the active module`).toBeVisible();
    // Either the overview stage or a module panel must render — never an empty stage
    // and never the ErrorBoundary fallback.
    await expect(page.locator('.overview-stage, .module-content-scroll')).toBeVisible();
    await expect(page.getByTestId('error-boundary'), `${label} crashed`).toHaveCount(0);
  }

  expect(consoleErrors, 'console errors while touring the modules').toEqual([]);
  expect(failedRequests, 'failed requests while touring the modules').toEqual([]);
});

test('an injected generator failure on bharati shows up as a bharati alert', async ({ page, request }) => {
  const { consoleErrors, failedRequests } = watchForProblems(page);

  await page.goto('/');
  await expect(page.locator('.overview-stage')).toBeVisible();
  await openStation(page, 'bharati');

  // Inject through the API, exactly as Demo Control does.
  const inject = await request.post(`${API}/api/sim/inject/generator_failure?stationId=bharati`);
  expect(inject.ok(), await inject.text()).toBeTruthy();

  // The backend tick (2 s) evaluates thresholds and pushes the alert over the WebSocket.
  const pill = page.getByTestId('alerts-pill');
  await expect
    .poll(async () => Number(await pill.getAttribute('data-alert-count')), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // It is bharati's alert, and the backend agrees.
  const alerts = await (await request.get(`${API}/api/alerts?stationId=bharati`)).json();
  expect(alerts.stationId).toBe('bharati');
  expect(alerts.activeAlerts.length).toBeGreaterThan(0);

  await page.getByTestId('alerts-pill').click();
  await expect(page.getByTestId('alert-drawer')).toBeVisible();

  await request.post(`${API}/api/sim/reset?stationId=bharati`);
  expect(consoleErrors, 'console errors during alert injection').toEqual([]);
  expect(failedRequests, 'failed requests during alert injection').toEqual([]);
});
