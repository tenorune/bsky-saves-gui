import { test, expect } from '@playwright/test';

// The single most valuable e2e check: page mounts, no uncaught errors,
// no 4xx on same-origin requests. Catches the broadest class of bundle
// regressions in one test.
//
// Cross-origin failures (helper probe at 127.0.0.1:47826, Pyodide CDN
// fetches when triggered) are NOT failures here — they're expected when
// the bundle runs without a real helper / before any backup is initiated.

test('app mounts with no uncaught errors and no same-origin 4xx/5xx', async ({ page, baseURL }) => {
  const pageErrors: Error[] = [];
  const badResponses: { url: string; status: number }[] = [];

  page.on('pageerror', (err) => pageErrors.push(err));

  page.on('response', (resp) => {
    const url = new URL(resp.url());
    const base = new URL(baseURL!);
    if (url.origin !== base.origin) return; // ignore cross-origin (helper, CDN, PDS)
    if (resp.status() >= 400) {
      badResponses.push({ url: resp.url(), status: resp.status() });
    }
  });

  await page.goto('/');

  // Wait for Svelte to mount #app with children.
  await expect(page.locator('#app')).not.toBeEmpty({ timeout: 5_000 });

  // Give async setup (SW registration, route loading, store init) a moment
  // to settle and surface any deferred errors.
  await page.waitForLoadState('networkidle');

  expect(pageErrors, `uncaught page errors:\n${pageErrors.map((e) => e.stack ?? e.message).join('\n')}`).toEqual([]);
  expect(badResponses, `same-origin 4xx/5xx responses:\n${JSON.stringify(badResponses, null, 2)}`).toEqual([]);
});
