import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the production builds (`npm run build` first). The API serves
 * one demo repository indexed from the in-memory fixture (apps/api/scripts/seed-e2e.ts),
 * with AI and GitHub access switched off, so runs are offline and deterministic.
 */
const CI = Boolean(process.env.CI);
// Set E2E_WEB_PORT when something else already listens on 3000.
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3000';
const WEB_URL = `http://localhost:${WEB_PORT}`;

const apiEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  PORT: '4000',
  WEB_ORIGIN: WEB_URL,
  JWT_SECRET: 'e2e-secret-that-is-at-least-32-characters-long',
  DEMO_REPOSITORIES: 'e2e/payments-api',
  RUN_WORKER_IN_PROCESS: 'false',
  TRUST_PROXY: 'false',
  PROXY_SECRET: '',
  GEMINI_API_KEY: '',
  GITHUB_TOKEN: '',
};

export default defineConfig({
  testDir: './e2e',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: 1,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'npx tsx apps/api/scripts/seed-e2e.ts && npm run start --workspace @codebase-copilot/api',
      url: 'http://localhost:4000/api/health/live',
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run start --workspace @codebase-copilot/web',
      url: WEB_URL,
      env: { PORT: WEB_PORT, API_URL: 'http://localhost:4000', PROXY_SECRET: '' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
