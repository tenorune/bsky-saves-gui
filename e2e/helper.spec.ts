// S5 (helper-served) — Playwright against a real `bsky-saves serve --gui`.
//
// The helper listens on http://127.0.0.1:47826 by default, serving both
// the bundled GUI at `/` and the helper API at `/api/*`. CI installs the
// latest published wheel, boots the helper, and runs this suite against
// it. Locally, devs without a helper see the suite cleanly skip — the
// beforeAll probe checks `/` and sets a guard.
//
// What this catches:
//   - Wheel installation works at all.
//   - Helper boots, binds the expected port, serves the GUI HTML.
//   - /api/version, /api/health match the contract from
//     docs/bsky-saves-gui-dist-workstream.md §4.
//   - GUI mounts without uncaught console errors against a live helper.
//
// What this does NOT catch (yet):
//   - Authenticated flows (sign-in, library, backup-trigger). Those need
//     a recorded fixture and a way to inject a session — deferred.

import { test, expect } from '@playwright/test';

const HELPER_ORIGIN =
  process.env.BSKY_SAVES_HELPER_ORIGIN ?? 'http://127.0.0.1:47826';

test.use({ baseURL: HELPER_ORIGIN });

let helperReachable = false;

test.beforeAll(async () => {
  try {
    const res = await fetch(HELPER_ORIGIN, {
      signal: AbortSignal.timeout(2000),
    });
    helperReachable = res.ok;
  } catch {
    helperReachable = false;
  }
});

test.beforeEach(({}, testInfo) => {
  testInfo.skip(
    !helperReachable,
    `No bsky-saves helper reachable at ${HELPER_ORIGIN}. Run \`bsky-saves serve --gui\` to enable this suite.`,
  );
});

test('GET / serves the bundled GUI', async ({ page }) => {
  await page.goto('/');
  // The sign-in page is the GUI's entrypoint when there's no inventory.
  await expect(
    page.getByRole('heading', { name: 'Sign in to Bluesky' }),
  ).toBeVisible();
});

test('GET /api/health returns 200', async () => {
  const res = await fetch(`${HELPER_ORIGIN}/api/health`);
  expect(res.status).toBe(200);
});

test('GET /api/version returns the documented shape', async () => {
  // Contract per docs/bsky-saves-gui-dist-workstream.md §4 item 13:
  //   { "helper": "0.4.3", "protocol": "1", "gui_bundled": "0.5.0" }
  // Strict on `helper` (semver-ish) and `protocol` (string); `gui_bundled`
  // is best-effort because some wheel versions may not have it yet.
  const res = await fetch(`${HELPER_ORIGIN}/api/version`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(typeof body.helper).toBe('string');
  expect(body.helper as string).toMatch(/^\d+\.\d+\.\d+/);
  expect(typeof body.protocol).toBe('string');
});

test('sign-in page mounts without console errors against a live helper', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Sign in to Bluesky' }),
  ).toBeVisible();

  // Allow probeHelper() + capability snapshot to settle. The probe fires
  // at app boot via main.ts::initCapabilitySnapshot, and the snapshot
  // store updates a few hundred ms later.
  await page.waitForTimeout(1500);

  expect(errors, `Unexpected errors:\n${errors.join('\n')}`).toEqual([]);
});
