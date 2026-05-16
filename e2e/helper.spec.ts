// S5 (helper-served) — Playwright against a real `bsky-saves serve --gui`.
//
// The helper listens on http://127.0.0.1:47826 by default, serving both
// the bundled GUI at `/` and the helper API surface (`/ping`, `/fetch`,
// `/enrich`, `/hydrate-threads`, `/fetch-image`, `/extract-article`).
// CI installs the latest published wheel, boots the helper, and runs
// this suite against it. Locally, devs without a helper see the suite
// cleanly skip — the `beforeAll` probe checks /ping and sets a guard.
//
// What this catches:
//   - Wheel installation works at all.
//   - Helper boots, binds the expected port, serves the GUI HTML.
//   - /ping matches the diagnostic shape from
//     docs/bsky-saves-gui-dist-workstream.md §4 item 13 — `name`,
//     `version`, `protocol`, `gui_bundled`, `features`. All five fields
//     are required of the helper we exercise (CI installs the latest
//     PyPI wheel, which is >= v0.6.1; `protocol` + `gui_bundled` shipped
//     in v0.6.1 and the suite floors there).
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
  // Probe /ping — works regardless of whether `--gui` is passed, so the
  // suite can run against a helper that exposes only the API surface.
  try {
    const res = await fetch(`${HELPER_ORIGIN}/ping`, {
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

test('GET /ping returns the bsky-saves diagnostic payload', async () => {
  const res = await fetch(`${HELPER_ORIGIN}/ping`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  // Strict on what `helper-client.ts::isPingPayload` validates at runtime
  // — the GUI refuses to use a helper whose /ping doesn't satisfy this.
  expect(body.name).toBe('bsky-saves');
  expect(typeof body.version).toBe('string');
  expect(body.version as string).toMatch(/^\d+\.\d+\.\d+/);
  expect(Array.isArray(body.features)).toBe(true);
  // v0.6.1 added protocol + gui_bundled; CI installs the latest wheel
  // (>= 0.6.1) so both are required. `gui_bundled` is null for dev
  // installs but the wheel always populates it.
  expect(typeof body.protocol).toBe('string');
  expect(typeof body.gui_bundled === 'string' || body.gui_bundled === null).toBe(true);
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
