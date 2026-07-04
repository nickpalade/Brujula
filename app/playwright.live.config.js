import { defineConfig, devices } from '@playwright/test';

const APP_PORT = 5219;
const HUB_PORT = 8021;
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const HUB_URL = `http://127.0.0.1:${HUB_PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /live-.*\.spec\.js/,
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-live',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `node tests/fixtures/live-hub.mjs`,
      url: `${HUB_URL}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        BRUJULA_PROVIDER: 'mock',
        BRUJULA_CHAT_PROVIDER: 'mock',
        BRUJULA_DATA_DIR: 'test-results/live-hub-data',
        BRUJULA_LANG: 'en',
        E2E_HUB_PORT: String(HUB_PORT),
        REPORT_ACK_TIMEOUT_MS: '5000',
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${APP_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_BASE: HUB_URL,
        VITE_USE_MOCKS: 'false',
      },
    },
  ],
});
