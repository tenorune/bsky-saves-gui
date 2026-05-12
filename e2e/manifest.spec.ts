import { test, expect } from '@playwright/test';

// PWA manifest validates structurally, every icon URL it advertises
// resolves, and at least one icon is a PNG fallback in case a browser
// can't render SVG icons (Chrome PWA install prompt is one).

test('manifest.webmanifest is valid JSON with required PWA fields', async ({ request }) => {
  const resp = await request.get('/manifest.webmanifest');
  expect(resp.status()).toBe(200);

  const manifest = await resp.json();
  expect(manifest.name, 'manifest.name').toBeTruthy();
  expect(manifest.start_url, 'manifest.start_url').toBeTruthy();
  expect(manifest.scope, 'manifest.scope').toBeTruthy();
  expect(Array.isArray(manifest.icons), 'manifest.icons is an array').toBe(true);
  expect(manifest.icons.length, 'manifest.icons is non-empty').toBeGreaterThan(0);
});

test('every manifest icon URL resolves with a 200', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  for (const icon of manifest.icons) {
    const resp = await request.get(`/${icon.src.replace(/^\/+/, '')}`);
    expect(resp.status(), `icon ${icon.src} should resolve`).toBe(200);
  }
});

test('at least one icon is a PNG fallback', async ({ request }) => {
  // Chrome's PWA install dialog prefers raster icons even when the
  // manifest also advertises SVG. Without a PNG, the install prompt
  // falls back to the favicon, which looks rough at large sizes.
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  const pngIcons = manifest.icons.filter((i: { type?: string }) => i.type === 'image/png');
  expect(pngIcons.length, 'manifest must include at least one PNG icon').toBeGreaterThan(0);
});
