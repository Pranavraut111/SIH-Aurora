/* Aurora — end-to-end smoke test (tests/e2e).
   Brings up the real stack: unified backend (:8080) → simulator (:8001) → Vite (:5173),
   in that order, the same order start.sh uses. No secrets: GROQ_API_KEY is cleared so the
   AI panels must fall back to the offline explainer. */
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const API_PORT = process.env.API_PORT || '8080';
const SIM_PORT = process.env.SIM_PORT || '8001';
const VITE_PORT = process.env.VITE_PORT || '5173';

// Set E2E_BASE_URL to run the same specs against an already-running stack — notably the
// Docker one, where nginx serves the UI and proxies /api and /ws on a single origin.
// Playwright then starts nothing itself.
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;
// Absolute: the Python services run with cwd=simulator/.
const PYTHON = process.env.AURORA_PYTHON || path.resolve('.venv/bin/python');
// A throwaway DB: the smoke test writes alerts and ingestion logs, and
// simulator/data_store/antarctic_observations.db is committed for the offline demo.
const DB_PATH = process.env.DB_PATH || path.resolve('test-results/e2e-observations.db');

// The services read these from the environment (simulator/config.py), never from argv.
const serviceEnv = {
  ...process.env,
  API_PORT,
  SIM_PORT,
  HOST: '127.0.0.1',
  ALLOWED_ORIGINS: `http://localhost:${VITE_PORT}`,
  LOG_LEVEL: 'WARNING',
  DB_PATH,
  GROQ_API_KEY: '',
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
