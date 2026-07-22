import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Plaster Void E2E suite (T062).
 *
 * Points at the STATIC PREVIEW server (`npm run preview`, i.e. `astro preview` over
 * `dist/`) rather than `astro dev` — this exercises the actual build artifact users
 * get in production and avoids Vite dev-server dep-optimization reload flakiness
 * (see scripts/diagnose.mjs's 504 "Outdated Optimize Dep" workaround, which the
 * production build does not need).
 *
 * Port 4402 is deliberately non-default (Astro dev defaults to 4321; other agents'
 * tooling may be on other ports) to avoid collisions while multiple agents work on
 * this repo in parallel.
 *
 * Cesium tile loading is slow even under software rendering (SwiftShader) — timeouts
 * here are generous relative to Playwright's defaults. Individual specs additionally
 * wait on `window.__cesium` scene-state signals (the same technique scripts/diagnose.mjs
 * uses) rather than fixed sleeps where possible.
 */
const PORT = 4402;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false, // one Cesium instance per test is heavy; keep workers modest
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-swiftshader',
      use: {
        ...devices['Desktop Chrome'],
        // Same SwiftShader/ANGLE flags scripts/diagnose.mjs and scripts/screenshot.mjs
        // use to get a working (software) WebGL context in headless CI — Cesium
        // requires WebGL to construct its scene at all, even for non-@gpu assertions
        // that never read back pixels.
        launchOptions: {
          args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
        },
      },
    },
  ],
  webServer: {
    command: `npx astro preview --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
