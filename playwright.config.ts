import { defineConfig, devices } from '@playwright/test';

// Override ports when several checkouts run e2e at once (e.g. parallel worktrees)
const DEV_PORT = Number(process.env.CLIPBOX_DEV_PORT ?? 5199);
const PREVIEW_PORT = Number(process.env.CLIPBOX_PREVIEW_PORT ?? 5198);
const DEV = `http://localhost:${DEV_PORT}`;
const PREVIEW = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  projects: [
    {
      name: 'dev',
      testIgnore: /(offline|background)\.spec/,
      use: { ...devices['Desktop Chrome'], baseURL: DEV },
    },
    {
      // Service worker only exists in production builds
      name: 'preview',
      testMatch: /(offline|background)\.spec/,
      use: { ...devices['Desktop Chrome'], baseURL: PREVIEW, serviceWorkers: 'allow' },
    },
  ],
  webServer: [
    {
      command: `pnpm exec vite --port ${DEV_PORT} --strictPort`,
      url: DEV,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm run build && pnpm exec vite preview --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
