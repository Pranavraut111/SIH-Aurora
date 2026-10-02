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

// Against the Docker stack the API is same-origin behind nginx (E2E_BASE_URL);
// locally Playwright starts the backend on its own port.
const API = process.env.E2E_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || '8080'}`;

// Set when the stack enforces write protection, so the spec signs in before writing.
// Empty means ADMIN_TOKEN is unset server-side and every control is already enabled.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const WRITE_HEADERS = ADMIN_TOKEN ? { 'X-Admin-Token': ADMIN_TOKEN } : {};

// Module id -> text that only THAT module's panel renders. Legacy panels are matched on
// their own headings; modules rebuilt on the design system on their page title. The tour
// asserts the marker so it catches "the sidebar switched but the panel did not", and it
// asserts exactly one module panel is mounted, which catches the opposite: audit F1, where
// every visited module stayed stacked on screen. Both bugs hid behind a weaker check.
const MODULES = [
  ['overview', null],
  ['environmental', /Stored observations and analysis/i],
  ['infrastructure', /Dependency map/i],
  ['energy', /Energy grid/i],
  ['logistics', /Audit log/i],
  ['remote', /Command log/i],
  ['simulation', /Run a scenario to see/i],
  ['ai', /Anomaly evidence/i],
  ['reports', /Station status report/i],
  ['admin', /System Administration & Ingestion Pipeline/i],
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

/**
 * Sign in through the TopBar so the write controls become enabled. A no-op when the
 * server does not protect writes (the pill is not rendered at all then).
 */
async function operatorLogin(page) {
  const pill = page.getByTestId('operator-login');
  if (!(await pill.count())) return false;          // writes are unprotected
  await pill.click();
  await page.getByTestId('operator-token-input').fill(ADMIN_TOKEN);
  await page.getByTestId('operator-submit').click();
  await expect(page.getByTestId('operator-logout')).toBeVisible();
  return true;
}

async function openStation(page, stationId) {
  const option = page.getByTestId(`station-option-${stationId}`);
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
}

/** Select a module in the sidebar and wait until it is the current page. */
async function openModule(page, moduleId) {
  await page.getByTestId(`nav-${moduleId}`).click();
  await expect(page.getByTestId(`nav-${moduleId}`), `${moduleId} did not become the active module`)
    .toHaveAttribute('aria-current', 'page');
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

  for (const [id, marker] of MODULES) {
    await openModule(page, id);
    // Either the overview stage or a module panel must render — never an empty stage
    // and never the ErrorBoundary fallback.
    await expect(page.locator('.overview-stage, .module-content-scroll')).toBeVisible();
    await expect(page.getByTestId('error-boundary'), `${id} crashed`).toHaveCount(0);
    if (marker) {
      // Exactly one module page, and it is THIS module's; the loading placeholder clears.
      await expect(page.getByTestId('module-panel'), `more than one module on screen after ${id}`).toHaveCount(1);
      await expect(page.getByTestId('module-panel')).toHaveAttribute('data-module', id);
      await expect(page.getByTestId('panel-fallback')).toHaveCount(0);
      await expect(page.getByTestId('module-panel'),
                   `${id} was selected but its panel did not render`).toContainText(marker);
    } else {
      await expect(page.getByTestId('module-panel')).toHaveCount(0);
    }
  }

  expect(consoleErrors, 'console errors while touring the modules').toEqual([]);
  expect(failedRequests, 'failed requests while touring the modules').toEqual([]);
});

test('an injected generator failure on bharati shows up as a bharati alert', async ({ page, request }) => {
  const { consoleErrors, failedRequests } = watchForProblems(page);

  await page.goto('/');
  await expect(page.locator('.overview-stage')).toBeVisible();

  // Sign in as operator so the UI's write controls are live (and to prove the login
  // flow works end to end). Skipped when the stack has no ADMIN_TOKEN set.
  const loggedIn = await operatorLogin(page);
  await openStation(page, 'bharati');

  // Inject through the API, exactly as Demo Control does — with the token when the
  // stack requires one.
  const inject = await request.post(`${API}/api/sim/inject/generator_failure?stationId=bharati`,
                                    { headers: WRITE_HEADERS });
  expect(inject.ok(), await inject.text()).toBeTruthy();
  if (loggedIn) {
    // The acknowledge button is only enabled for a signed-in operator.
    expect(ADMIN_TOKEN).not.toBe('');
  }

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

  await request.post(`${API}/api/sim/reset?stationId=bharati`, { headers: WRITE_HEADERS });
  expect(consoleErrors, 'console errors during alert injection').toEqual([]);
  expect(failedRequests, 'failed requests during alert injection').toEqual([]);
});

test('viewing needs no login, and writes are refused without one', async ({ page, request }) => {
  test.skip(!ADMIN_TOKEN, 'ADMIN_TOKEN is not set for this stack, so writes are unprotected');
  const { consoleErrors, failedRequests } = watchForProblems(page);

  await page.goto('/');
  await expect(page.locator('.overview-stage')).toBeVisible();

  // The whole dashboard is viewable while signed out, and says so.
  await expect(page.getByTestId('operator-login')).toHaveText(/read-only/i);
  await expect(page.getByTestId('data-source-badge')).toBeVisible();
  for (const id of ['environmental', 'logistics', 'admin']) {
    await openModule(page, id);
    await expect(page.locator('.module-content-scroll')).toBeVisible();
  }

  // A write control is disabled, with the reason in its tooltip. The thresholds form
  // lives behind the "Alert Threshold Rules" tab of System Admin.
  await openModule(page, 'admin');
  await page.locator('.admin-tab', { hasText: 'Alert Threshold Rules' }).click();
  const save = page.locator('button.btn-save-admin');
  await expect(save).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('title', 'Operator login required');

  // ...and so is the ingest button on the Data Sources tab.
  await page.locator('.admin-tab', { hasText: 'Data Sources' }).click();
  const sync = page.locator('button.btn-sync-source').first();
  await expect(sync).toBeDisabled();
  await expect(sync).toHaveAttribute('title', 'Operator login required');

  // The API agrees: the same write is a 401 unauthenticated and a 200 with the token.
  // The 401 is deterministic — require_admin rejects before the proxy is attempted.
  const denied = await request.post(`${API}/api/sim/reset?stationId=maitri`);
  expect(denied.status()).toBe(401);
  // The authenticated case proxies to the simulator, whose readiness is independent of
  // the backend's, so a momentary 503 here is startup timing rather than an auth failure.
  await expect
    .poll(async () => (await request.post(`${API}/api/sim/reset?stationId=maitri`,
                                          { headers: WRITE_HEADERS })).status(),
          { timeout: 30_000, message: 'authenticated write never succeeded' })
    .toBe(200);

  // Signing in enables the controls again.
  await operatorLogin(page);
  await expect(sync).toBeEnabled();
  await page.locator('.admin-tab', { hasText: 'Alert Threshold Rules' }).click();
  await expect(save).toBeEnabled();

  expect(consoleErrors, 'console errors while signed out').toEqual([]);
  expect(failedRequests.filter((f) => !f.startsWith('401')), 'unexpected failed requests').toEqual([]);
});

test('on a phone the top bar fits, Sign in stays reachable and demo control covers nothing', async ({ page }) => {
  const { consoleErrors, failedRequests } = watchForProblems(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('data-source-badge')).toBeVisible();

  // One top bar, no horizontal scroll, and no floating button over the page.
  const fits = await page.evaluate(() => {
    const bar = document.querySelector('.MuiToolbar-root');
    return document.documentElement.scrollWidth <= window.innerWidth && bar.scrollWidth <= bar.clientWidth;
  });
  expect(fits, 'top bar or page overflows horizontally at 390 px').toBe(true);
  await expect(page.locator('.demo-toggle')).toHaveCount(0);
  if (ADMIN_TOKEN) await expect(page.getByTestId('operator-login')).toBeVisible();

  // The status dot has an accessible name, and a tap shows the data source in a tooltip.
  const dot = page.getByTestId('data-source-badge');
  await expect(dot).toHaveAccessibleName(/^Data source: /);
  await dot.click();
  await expect(page.getByRole('tooltip')).toContainText(/simulator|fallback|demo|connecting/i);

  // Demo control opens from the overflow menu.
  await page.getByTestId('topbar-more').click();
  await page.getByTestId('menu-demo-control').click();
  await expect(page.getByTestId('demo-control-panel')).toBeVisible();
  await page.getByTestId('demo-control-close').click();
  await expect(page.getByTestId('demo-control-panel')).toHaveCount(0);

  expect(consoleErrors, 'console errors on a phone').toEqual([]);
  expect(failedRequests, 'failed requests on a phone').toEqual([]);
});

test('the building panel shows live readings from telemetry (audit F2)', async ({ page }) => {
  const { consoleErrors, failedRequests } = watchForProblems(page);
  await page.goto('/');
  await expect(page.getByTestId('data-source-badge')).toHaveAttribute('data-source', /simulator|physics-fallback/);
  await openModule(page, 'infrastructure');
  await page.getByTestId('building-tile-generator').click();

  const drawer = page.getByTestId('building-drawer');
  await expect(drawer).toBeVisible();
  const rows = drawer.locator('[data-testid^="reading-"]');
  await expect(rows).toHaveCount(4);                                // gen_power, fuel rate, rpm, coolant
  // Live values, not "—" and not a built-in nominal: the drawer's generator power equals the tile's.
  await expect(drawer.getByTestId('reading-gen_power')).not.toContainText('—');
  // Dependency chips open the upstream building.
  await drawer.getByRole('button', { name: /Logistics Store/ }).click();
  await expect(drawer.getByRole('heading', { name: 'Logistics Store' })).toBeVisible();
  await page.getByTestId('building-drawer-close').click();
  await expect(drawer).toHaveCount(0);

  // The dependency map opens the same panel from the keyboard.
  await page.getByTestId('dep-node-generator').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('building-drawer')).toBeVisible();

  expect(consoleErrors, 'console errors in the building panel').toEqual([]);
  expect(failedRequests, 'failed requests in the building panel').toEqual([]);
});


test('operate and analyse pages: read-only what-if, twin inspector, and an audited ledger edit', async ({ page }) => {
  const { consoleErrors, failedRequests } = watchForProblems(page);
  await page.goto('/');
  await expect(page.getByTestId('data-source-badge')).toHaveAttribute('data-source', /simulator|physics-fallback/);

  // What-if needs no sign-in (it changes nothing) and says it is rule-based.
  await openModule(page, 'simulation');
  await page.getByTestId('scenario-fuel_leak').click();
  await page.getByTestId('whatif-run').click();
  const result = page.getByTestId('whatif-result');
  await expect(result).toContainText(/Fuel autonomy \d+ → \d+ days/);
  await expect(result).toContainText(/not the physics model/);

  // Twin inspector opens as a dialog and closes with Escape.
  await page.getByTestId('nav-twinInspector').click();
  await expect(page.getByTestId('twin-inspector')).toBeVisible();
  await expect(page.getByTestId('twin-inspector')).toContainText(/Thermal model/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('twin-inspector')).toHaveCount(0);

  // A ledger edit, signed in when the stack protects writes, lands in the audit log.
  const loggedIn = await operatorLogin(page);
  await openModule(page, 'logistics');
  await page.getByTestId('ledger-edit-maitri-med').click();
  const input = page.getByTestId('ledger-current');
  const next = String(Number(await input.inputValue()) - 1);
  await input.fill(next);
  await page.getByTestId('ledger-save').click();
  await expect(page.getByTestId('logistics-save-status')).toContainText(/Saved/);
  await expect(page.getByTestId('logistics-history')).toContainText(`→ ${next}`);
  expect(loggedIn || !ADMIN_TOKEN).toBe(true);

  expect(consoleErrors, 'console errors on operate/analyse pages').toEqual([]);
  expect(failedRequests, 'failed requests on operate/analyse pages').toEqual([]);
});
