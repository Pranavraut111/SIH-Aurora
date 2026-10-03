/* Aurora — end-to-end smoke test (tests/e2e).
   Brings up the real stack: unified backend (:8080) → simulator (:8001) → Vite (:5173),
   in that order, the same order start.sh uses. No secrets: GROQ_API_KEY is cleared so the
   AI panels must fall back to the offline explainer. */
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Ports of their own (not the dev defaults 8080/8001/5173), so a dev or screenshot stack left
// running is never silently reused for the test. Set in process.env so the spec sees them too.
process.env.API_PORT ||= '18080';
process.env.SIM_PORT ||= '18001';
process.env.VITE_PORT ||= '15173';
const API_PORT = process.env.API_PORT;
const SIM_PORT = process.env.SIM_PORT;
const VITE_PORT = process.env.VITE_PORT;

// Set E2E_BASE_URL to run the same specs against an already-running stack — notably the
// Docker one, where nginx serves the UI and proxies /api and /ws on a single origin.
// Playwright then starts nothing itself.
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;
// Absolute: the Python services run with cwd=simulator/.
const PYTHON = process.env.AURORA_PYTHON || path.resolve('.venv/bin/python');
// A throwaway DB: the smoke test writes alerts and ingestion logs, and
// simulator/data_store/antarctic_observations.db is committed for the offline demo.
const DB_PATH = process.env.DB_PATH || path.resolve('test-results/e2e-observations.db');

// The local/CI stack runs as the public deployment does (judge mode): writes protected by
// a team token (a throwaway one unless ADMIN_TOKEN is given), anonymous visitors in a
// private sandbox, public demo scenarios on. Set in process.env so the spec sees it too.
// The per-visitor demo cooldown is shortened here only, so several stories can run back to
// back from one address; the 60 s rule itself is covered by the backend tests. Against
// E2E_BASE_URL the deployment's own settings apply.
if (!EXTERNAL_BASE_URL) process.env.ADMIN_TOKEN ||= 'e2e-team-token';

// The services read these from the environment (simulator/config.py), never from argv.
const serviceEnv = {
  ...process.env,
  API_PORT,
  SIM_PORT,
  HOST: '127.0.0.1',
  ALLOWED_ORIGINS: `http://localhost:${VITE_PORT}`,
  // Wire every service to the test ports (env vars win over the root .env).
  BACKEND_URL: `http://127.0.0.1:${API_PORT}`,
  SIMULATOR_URL: `http://127.0.0.1:${SIM_PORT}`,
  VITE_API_URL: `http://localhost:${API_PORT}`,
  VITE_WS_URL: `ws://localhost:${API_PORT}/ws/station`,
  LOG_LEVEL: 'WARNING',
  DB_PATH,
  GROQ_API_KEY: '',
  VISITOR_SANDBOX: 'true',
  PUBLIC_DEMO: 'true',
  PUBLIC_DEMO_COOLDOWN_S: '3',
  // Never fetch the real NCPOR site from a test run (the freshness line says so).
  NCPOR_SYNC_INTERVAL_MIN: '0',
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: EXTERNAL_BASE_URL || `http://localhost:${VITE_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Software WebGL so the 3D twin renders headlessly instead of taking the 2D fallback.
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: EXTERNAL_BASE_URL ? undefined : [
    {
      command: `${PYTHON} unified_backend.py`,
      cwd: 'simulator',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: serviceEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `${PYTHON} simulator.py`,
      cwd: 'simulator',
      url: `http://127.0.0.1:${SIM_PORT}/health`,
      env: serviceEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npm run dev -- --port ${VITE_PORT} --strictPort`,
      url: `http://localhost:${VITE_PORT}`,
      env: serviceEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
