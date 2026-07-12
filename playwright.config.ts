import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:8123';

export default defineConfig({
  testDir: './test/e2e',
  use: {
    baseURL,
  },
  webServer: {
    command: 'node test/e2e/serve-epk.mjs',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
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
