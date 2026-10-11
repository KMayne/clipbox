import { defineConfig, devices } from '@playwright/test';

const DEV = 'http://localhost:5199';
const PREVIEW = 'http://localhost:5198';

export default defineConfig({
  testDir: 'tests/e2e',
  projects: [
    {
      name: 'dev',
      testIgnore: /offline\.spec/,
      use: { ...devices['Desktop Chrome'], baseURL: DEV },
    },
    {
      // Service worker only exists in production builds
      name: 'preview',
      testMatch: /offline\.spec/,
      use: { ...devices['Desktop Chrome'], baseURL: PREVIEW, serviceWorkers: 'allow' },
    },
  ],
  webServer: [
    {
      command: 'pnpm exec vite --port 5199 --strictPort',
      url: DEV,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm run build && pnpm exec vite preview --port 5198 --strictPort',
      url: PREVIEW,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
