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
      testIgnore: /(offline|background|pwa)\.spec/,
      use: { ...devices['Desktop Chrome'], baseURL: DEV },
    },
    {
      // Service worker only exists in production builds
      name: 'preview',
      testMatch: /(offline|background|pwa)\.spec/,
      use: { ...devices['Desktop Chrome'], baseURL: PREVIEW, serviceWorkers: 'allow' },
    },
  ],
  webServer: [
    {
      // Node 26.13's V8 can abort ("Lazy deopt after a fast API call with return value is
      // unsupported") in Buffer.byteLength while Vite sends a large module, killing the server
      // mid-run. Without TurboFan fast API calls that path can't be taken.
      command: `node --no-turbo-fast-api-calls node_modules/vite/bin/vite.js --port ${DEV_PORT} --strictPort`,
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
