# Plan 18: align article-backup CTAs + fix worker launcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make the article-backup buttons say what they actually do, and make them actually work for users whose only backend is a custom Cloudflare Worker (Plan 22 oversight).

**Architecture:** Two related changes shipped together. (1) `app/src/lib/start-article-backup.ts` precheck accepts either the helper (with `extract-article` feature) OR a saved proxy config with `supportsArticles: true`. (2) The article banner button, image banner button, and Settings article-row button all standardize on "Save my own copy" with no trailing arrow.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `ee91ef6` (spec commit) or later.

---

## File structure

**Modified:**
- `app/src/lib/start-article-backup.ts` — precheck accepts helper OR worker.
- `app/src/lib/start-article-backup.test.ts` — new + updated tests for the fallback.
- `app/src/components/BackupBanner.svelte` — drop trailing `→` from body and button.
- `app/src/components/ArticleBackupBanner.svelte` — body and button copy mirror image banner.
- `app/src/routes/Settings.svelte` — Articles row button reads "Save my own copy".

---

## Task 1: Launcher accepts worker fallback

**Files:**
- Modify: `app/src/lib/start-article-backup.ts`
- Modify: `app/src/lib/start-article-backup.test.ts`

- [ ] **Step 1: Add the failing tests**

In `app/src/lib/start-article-backup.test.ts`, append three new cases inside the existing `describe('startArticleBackup', ...)` block:

```ts
  it('returns {started: true} when helper is absent but worker supportsArticles', async () => {
    let extractCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const u = typeof input === 'string' ? input : (input as Request).url;
        if (u.endsWith('/ping')) throw new TypeError('Failed to fetch');
        if (u.endsWith('/extract-article')) {
          extractCalls++;
          return {
            ok: true,
            json: async () => ({
              url: 'https://example.com/a',
              title: 't',
              text: 'body',
              fetched_at: '2026-05-04T12:00:00Z',
            }),
          };
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
    const { startArticleBackup } = await import('./start-article-backup');
    const { articleHydration } = await import('./hydration-state');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(true);
    await vi.waitUntil(() => get(articleHydration).status === 'done', { timeout: 1000 });
    expect(get(articleHydration).fetched).toBe(1);
    expect(extractCalls).toBe(1);
  });

  it('returns {started: false} with the unified reason when neither helper nor worker is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { clearProxyConfig } = await import('./proxy-config');
    await clearProxyConfig();
    const { startArticleBackup } = await import('./start-article-backup');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/no article backend available/i);
  });

  it('returns {started: false} when proxy config exists but supportsArticles is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: false });
    const { startArticleBackup } = await import('./start-article-backup');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/no article backend available/i);
  });
```

Also update the **existing** test at the top of the file that asserts the old "needs the local helper" message:

Find:

```ts
  it('returns {started: false, reason} when the helper is not running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { startArticleBackup } = await import('./start-article-backup');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/helper/i);
  });
```

Replace its assertion block to match the new unified reason (the helper-missing path now yields the unified message because the worker is also absent — this test starts with no proxy config since `beforeEach` doesn't set one):

```ts
  it('returns {started: false, reason} when the helper is not running and no worker is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { startArticleBackup } = await import('./start-article-backup');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/no article backend available/i);
  });
```

Also extend `beforeEach` to clear the proxy config so test isolation is guaranteed. Replace the existing `beforeEach` block at the top of the file with:

```ts
beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  const { clearInventory } = await import('./inventory-store');
  await clearInventory();
  const { resetArticleHydration } = await import('./hydration-state');
  resetArticleHydration();
  const { clearBackupPrefs } = await import('./backup-prefs');
  await clearBackupPrefs();
  const { clearProxyConfig } = await import('./proxy-config');
  await clearProxyConfig();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run app/src/lib/start-article-backup.test.ts
```

Expected: the three new tests fail (current launcher rejects whenever helper is absent, regardless of worker config); the updated test fails because the current reason matches `/helper/` not `/no article backend available/`.

- [ ] **Step 3: Update `app/src/lib/start-article-backup.ts`**

Replace the file with:

```ts
// Run-lifecycle helper for article backup. Wraps article-hydrator with the
// controls the UI needs:
//
// - startArticleBackup(inventory): probes available backends (helper or
//   user-deployed worker with article extraction). Returns {started:false,
//   reason} if neither is available. Otherwise spawns the hydration loop
//   (which picks the backend itself) and returns {started:true}.
//
// - cancelArticleBackup(): aborts the most recent run, or no-op.

import { probeConfiguredHelper } from './helper-client';
import { hydrateArticles } from './article-hydrator';
import { setBackupEnabled } from './backup-prefs';
import { loadProxyConfig } from './proxy-config';

export interface StartArticleResult {
  readonly started: boolean;
  readonly reason?: string;
}

let activeController: AbortController | null = null;

export async function startArticleBackup(inventory: unknown): Promise<StartArticleResult> {
  const helper = await probeConfiguredHelper();
  const helperOk =
    helper.status === 'available' && helper.features.includes('extract-article');

  if (!helperOk) {
    const proxy = await loadProxyConfig();
    if (!(proxy && proxy.supportsArticles)) {
      return {
        started: false,
        reason:
          'no article backend available — start the local helper or set up a custom worker that supports article extraction',
      };
    }
  }

  const controller = new AbortController();
  activeController = controller;

  // Mark articles as enabled so the discovery banner stops re-showing.
  void setBackupEnabled('articles', true);

  void hydrateArticles(inventory, { signal: controller.signal }).finally(() => {
    if (activeController === controller) activeController = null;
  });

  return { started: true };
}

export function cancelArticleBackup(): void {
  activeController?.abort();
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/start-article-backup.test.ts
```

Expected: 0 errors, 0 warnings; all 8 start-article-backup tests pass (5 existing + 3 new).

- [ ] **Step 5: Run the full suite to ensure nothing else regresses**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/start-article-backup.ts app/src/lib/start-article-backup.test.ts
git commit -m "fix(start-article-backup): accept worker fallback alongside helper"
```

DO NOT push.

---

## Task 2: CTA copy alignment

**Files:**
- Modify: `app/src/components/BackupBanner.svelte`
- Modify: `app/src/components/ArticleBackupBanner.svelte`
- Modify: `app/src/routes/Settings.svelte`

This task is mechanical text replacement across three files. Run all three changes, then commit once.

- [ ] **Step 1: Update `BackupBanner.svelte` (image banner)**

In `app/src/components/BackupBanner.svelte`, find the body paragraph:

```svelte
    <p class="backup-banner__text">
      {imageCount} of your saves include images. They'll work as long as Bluesky keeps
      them online. Save your own copy →
    </p>
```

Replace the trailing `Save your own copy →` with `Save your own copy.` (period instead of arrow):

```svelte
    <p class="backup-banner__text">
      {imageCount} of your saves include images. They'll work as long as Bluesky keeps
      them online. Save your own copy.
    </p>
```

Then find the primary button label:

```svelte
        Save my own copy →
```

Replace with:

```svelte
        Save my own copy
```

- [ ] **Step 2: Update `ArticleBackupBanner.svelte`**

In `app/src/components/ArticleBackupBanner.svelte`, find the body paragraph:

```svelte
    <p class="article-banner__text">
      {articleCount} of your saves link to articles. Save the full article
      text so it doesn't disappear if the source goes away. Set up backup →
    </p>
```

Replace with the image-banner-aligned copy:

```svelte
    <p class="article-banner__text">
      {articleCount} of your saves link to articles. Save the full article
      text so it doesn't disappear if the source goes away. Save your own copy.
    </p>
```

Then find the primary button label:

```svelte
        Set up backup →
```

Replace with:

```svelte
        Save my own copy
```

- [ ] **Step 3: Update `Settings.svelte` Articles row button**

In `app/src/routes/Settings.svelte`, find:

```svelte
          <button type="button" on:click={handleSetUpArticles}>Set up article backup</button>
```

Replace with:

```svelte
          <button type="button" on:click={handleSetUpArticles}>Save my own copy</button>
```

- [ ] **Step 4: Run check + build**

```bash
pnpm check && pnpm build
```

Expected: 0 errors, 0 warnings; both bundles build.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/BackupBanner.svelte app/src/components/ArticleBackupBanner.svelte app/src/routes/Settings.svelte
git commit -m "feat(banners,settings): unify article CTAs on \"Save my own copy\"; drop trailing arrows"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run the full test matrix + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all GUI tests pass; both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## Self-Review Checklist

- `start-article-backup.ts` precheck accepts worker fallback when helper is missing or lacks `extract-article`.
- The unified error string matches what the spec specified, character-for-character.
- All three button labels read "Save my own copy" with no trailing arrow.
- Both banner body copies end with "Save your own copy." (period, no arrow).
- Three commits, in order: launcher fix → copy update → (no third; final-verification step pushes only).
- `pnpm check && pnpm test && pnpm build` clean throughout.

## What's next

- **Plan 19**: Show Details modal for backup failures (per-failure list with permalinks + reasons).
- **Plan 20**: Banner sequencing (image first, article waits).
- **Plan 21**: PostFocus per-post backup status footer.
