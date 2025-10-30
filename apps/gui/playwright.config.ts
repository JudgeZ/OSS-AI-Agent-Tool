import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  testDir: './tests',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true
  },
  webServer: [
    {
      command: 'npm run mock:orchestrator',
      port: 4010,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      command: 'npm run dev:test',
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
};

export default config;
