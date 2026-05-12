import { test, expect } from '@playwright/test';

// Each route renders the heading we expect. Brittle to the heading text,
// but those texts change rarely and a regression is itself a regression
// worth catching. The GUI uses hash routing; URLs are #/<route>.

test('sign-in route renders at /', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Bluesky' })).toBeVisible();
});

test('privacy route renders at #/privacy (no inventory needed)', async ({ page }) => {
  await page.goto('/#/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  // Sanity-check the DOMPurified markdown actually mounted, not just the heading.
  await expect(page.getByText(/handles your data/i)).toBeVisible();
});

test('settings route renders at #/settings (no inventory needed)', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('library route redirects to sign-in when no inventory present', async ({ page }) => {
  // Playwright gives each test a fresh context, so IndexedDB starts empty.
  // The router guard in App.svelte redirects #/library → / under those
  // conditions; verify the guard hasn't been broken by a refactor.
  await page.goto('/#/library');
  await expect(page.getByRole('heading', { name: 'Sign in to Bluesky' })).toBeVisible();
});
