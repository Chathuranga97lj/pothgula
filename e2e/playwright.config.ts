import { defineConfig, devices } from '@playwright/test';

/**
 * The built API and web app, started fresh on a throwaway database
 * (`apps/api/test/e2e-prepare.ts` recreates it on every run). Build first:
 * `pnpm e2e` from the repository root does both.
 */
const API_PORT = 3100;
const WEB_PORT = 4173;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgres://pothgula:pothgula-dev-only@localhost:5433/pothgula_e2e';

export default defineConfig({
  testDir: './tests',
  // One database, one story at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Headroom for a freshly started API on a slow runner (the first sign-in hashes a password).
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'en-GB',
    timezoneId: 'Asia/Colombo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @pothgula/api e2e:prepare && pnpm --filter @pothgula/api start',
      cwd: '..',
      url: `http://localhost:${API_PORT}/api/health`,
      env: { DATABASE_URL, PORT: String(API_PORT), POTHGULA_JOBS: 'off' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @pothgula/web preview --port ${WEB_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${WEB_PORT}`,
      env: { POTHGULA_API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
