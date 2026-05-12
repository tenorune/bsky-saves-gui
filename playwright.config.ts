import { defineConfig, devices } from '@playwright/test';

// Static-context Playwright config: serves dist/ via python -m http.server
// and runs the e2e suite against it in Chromium. No helper, no Pyodide
// (those are out of scope until S5 wheel-served Playwright lands). The
// purpose here is to catch bundle-level regressions — broken refs,
// missing PWA manifest, CSP violations, route mounting failures — that
// unit tests can't see.

const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: ORIGIN,
    trace: 'on-first-retry',
    // Honour CSP. The default is to enforce; we want CSP to be observable
    // to csp.spec.ts. (Playwright respects page CSP by default.)
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // Mimics how GitHub Pages serves dist/: no SPA fallback (the GUI uses
    // hash routing), no header injection. Honest about what production
    // sees. Listens on 127.0.0.1 only — never 0.0.0.0.
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory dist`,
    url: ORIGIN,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
