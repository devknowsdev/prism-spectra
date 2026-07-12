import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:8123';

export default defineConfig({
  testDir: './test/e2e',
  use: {
    baseURL,
  },
  webServer: [
    {
      command: 'node test/e2e/serve-epk.mjs',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run workbench',
      url: 'http://127.0.0.1:3900/workbench',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        AI_FORGE_APP_PREVIEW: '1',
        AI_FORGE_APP_PREVIEW_CONFIG: 'test/e2e/spectra.preview.test.json',
        AI_FORGE_DAEMON_PORT: '3900',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        headless: true,
      },
    },
  ],
});
