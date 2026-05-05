# Plan 14: Backend transparency (Settings labels + banner subtitles)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make the GUI honest about which backend will be used *before* the user enables backup. Today the Settings page says `"not set up"` and the banner says `"Save my own copy →"` regardless of whether a helper, custom worker, or operator proxy is actually available. Users can't tell what'll happen when they click.

**Three small changes:**

1. **Shared helper** `describe-backend.ts` exporting `describeAvailableImageBackend()` and `describeArticleBackend()` — pure async functions that return a short human-readable description of the highest-priority available backend (or `null` when none).
2. **Settings → Backup** updates: when `!imagesEnabled` AND a backend is reachable, the `Images:` label says `"not yet enabled — would use the operator's proxy"` instead of `"not set up"`. Articles row similarly reflects helper availability.
3. **`BackupBanner` / `ArticleBackupBanner`** updates: each banner gets a subtitle line showing which backend will fire when the primary button is clicked.

**Out of scope (later plans):**
- In-app custom-proxy setup wizard.
- Show Details modal for backup failures.
- Banner sequencing.

**Tech Stack:** Svelte 4, TypeScript 5. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `4c5e1ec` (latest fix) or later.

---

## Task 1: `describe-backend.ts` helper

Two pure async functions that wrap `detectBackends()` and `probeConfiguredHelper()` to return short human-readable strings the UI can display. No new IDB or persistence — just composing existing detection.

**Files:**
- Create: `app/src/lib/describe-backend.ts`
- Create: `app/src/lib/describe-backend.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/describe-backend.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  const { clearProxyConfig } = await import('./proxy-config');
  await clearProxyConfig();
  const { clearBackupPrefs } = await import('./backup-prefs');
  await clearBackupPrefs();
});

const okPing = {
  ok: true,
  json: async () => ({
    name: 'bsky-saves',
    version: '0.3.0',
    features: ['fetch-image', 'extract-article'],
  }),
};

describe('describeAvailableImageBackend', () => {
  it('returns null when no backend is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { describeAvailableImageBackend } = await import('./describe-backend');
    expect(await describeAvailableImageBackend()).toBeNull();
  });

  it('describes the local helper when available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okPing));
    const { describeAvailableImageBackend } = await import('./describe-backend');
    const result = await describeAvailableImageBackend();
    expect(result).toMatch(/local helper/i);
    expect(result).toMatch(/0\.3\.0/);
  });

  it('describes the user-worker when configured and helper is offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { describeAvailableImageBackend } = await import('./describe-backend');
    const result = await describeAvailableImageBackend();
    expect(result).toMatch(/custom cloudflare worker/i);
  });

  it('describes the operator proxy as last resort', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    vi.doMock('./config', () => ({
      config: {
        helperOrigin: 'http://127.0.0.1:47826',
        operatorImageProxyUrl: 'https://operator.example/fetch',
        operatorImageProxySecret: 'op-secret',
      },
    }));
    const { describeAvailableImageBackend } = await import('./describe-backend');
    const result = await describeAvailableImageBackend();
    expect(result).toMatch(/operator/i);
    vi.doUnmock('./config');
  });
});

describe('describeArticleBackend', () => {
  it('returns {available: false} when helper is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { describeArticleBackend } = await import('./describe-backend');
    const result = await describeArticleBackend();
    expect(result.available).toBe(false);
  });

  it('returns {available: true, description} when helper advertises extract-article', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okPing));
    const { describeArticleBackend } = await import('./describe-backend');
    const result = await describeArticleBackend();
    expect(result.available).toBe(true);
    expect(result.description).toMatch(/local helper/i);
  });

  it('returns {available: false} when helper is up but lacks extract-article', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          name: 'bsky-saves',
          version: '0.2.0',
          features: ['fetch-image'], // no extract-article
        }),
      })),
    );
    const { describeArticleBackend } = await import('./describe-backend');
    const result = await describeArticleBackend();
    expect(result.available).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test describe-backend`

- [ ] **Step 3: Implement the module**

Create `app/src/lib/describe-backend.ts`:

```ts
// Short human-readable descriptions of the backend that WOULD be used for
// image / article backup, given current detection. Used by Settings labels
// and banner subtitles to make the layered backend strategy transparent
// before the user clicks "Save my own copy".

import { detectBackends } from './image-fetcher';
import { probeConfiguredHelper } from './helper-client';

/**
 * Returns a description of the highest-priority available image backend, or
 * `null` if none is available. The description is suitable for inline UI
 * copy ("not yet enabled — would use [description]").
 */
export async function describeAvailableImageBackend(): Promise<string | null> {
  const backends = await detectBackends();
  if (backends.length === 0) return null;
  const b = backends[0];
  if (b.kind === 'helper') return `the local helper (bsky-saves ${b.version})`;
  if (b.kind === 'user-worker') return 'your custom Cloudflare Worker';
  if (b.kind === 'operator-proxy') return "the operator's image proxy";
  return null;
}

export interface ArticleBackendStatus {
  readonly available: boolean;
  readonly description: string;
}

/**
 * Returns whether article backup is currently possible (the local helper is
 * running and advertises `extract-article`) plus a short description of the
 * status. Articles are helper-only; user-worker and operator-proxy backends
 * don't run trafilatura.
 */
export async function describeArticleBackend(): Promise<ArticleBackendStatus> {
  const status = await probeConfiguredHelper();
  if (status.status !== 'available') {
    return {
      available: false,
      description: 'the local helper is not running',
    };
  }
  if (!status.features.includes('extract-article')) {
    return {
      available: false,
      description: `local helper (bsky-saves ${status.version}) does not advertise article extraction`,
    };
  }
  return {
    available: true,
    description: `the local helper (bsky-saves ${status.version})`,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test describe-backend`

Expected: 7/7 passing.

- [ ] **Step 5: Run full check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors. Total goes 157 → 164.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(describe-backend): human-readable backend descriptions for UI"
```

DO NOT push.

---

## Task 2: Apply to `Settings.svelte`

Update the `imagesBackendLabel` and `articlesBackendLabel` reactive declarations to use the new helpers when the feature is not yet enabled.

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Add import**

In `Settings.svelte`'s `<script>` block, add (near the existing `import { detectBackends } from '$lib/image-fetcher';`):

```ts
import { describeAvailableImageBackend, describeArticleBackend } from '$lib/describe-backend';
```

- [ ] **Step 2: Add state for the descriptions**

Add two new state variables near `detectedBackends`:

```ts
  let availableImageBackendDesc: string | null = null;
  let articleBackendStatus: { available: boolean; description: string } = {
    available: false,
    description: 'the local helper is not running',
  };
```

- [ ] **Step 3: Compute descriptions in onMount and after backend changes**

Inside the existing `onMount` block, after `detectedBackends = await detectBackends();`, add:

```ts
    availableImageBackendDesc = await describeAvailableImageBackend();
    articleBackendStatus = await describeArticleBackend();
```

Also update the existing handlers that re-run `detectBackends()` (e.g., `handleSaveWorker`, `handleClearWorker`, `handleToggleOperatorProxyOptOut`) to refresh these too:

For each of those handlers, after the existing `detectedBackends = await detectBackends();` line, add:

```ts
    availableImageBackendDesc = await describeAvailableImageBackend();
```

(`articleBackendStatus` only changes when the helper status changes, which we don't actively re-probe, so leave it loaded once on mount.)

- [ ] **Step 4: Update the reactive labels**

Find the existing `$: imagesBackendLabel = ...` and `$: articlesBackendLabel = ...` blocks. Replace them with:

```ts
  $: imagesBackendLabel = imagesEnabled
    ? helperBackend
      ? `using local helper (bsky-saves ${helperBackend.version})`
      : workerBackend
        ? 'using your custom Cloudflare Worker'
        : detectedBackends.find((b) => b.kind === 'operator-proxy')
          ? "using the operator's image proxy"
          : 'no backend reachable right now'
    : availableImageBackendDesc !== null
      ? `not yet enabled — would use ${availableImageBackendDesc}`
      : 'not set up — no backend available';

  $: articlesBackendLabel = articlesEnabled
    ? helperBackend
      ? `using local helper (bsky-saves ${helperBackend.version})`
      : 'no helper running'
    : articleBackendStatus.available
      ? `not yet enabled — would use ${articleBackendStatus.description}`
      : `not set up — ${articleBackendStatus.description}`;
```

(Note: the `imagesEnabled` branch now also handles the operator-proxy "in use" case. Previously it incorrectly fell through to "no backend reachable right now" when the operator proxy was the active backend.)

- [ ] **Step 5: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings, 164/164 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): show which backend would be used when not yet enabled"
```

DO NOT push.

---

## Task 3: Apply to `BackupBanner` and `ArticleBackupBanner`

Each banner gets a subtitle line under the main message that names the backend that'll be used. When no backend is available, the banner shows a different message ("Set up the local helper or a Cloudflare Worker first") and the primary button becomes informative rather than actionable... actually, simpler: keep the primary button, let the click fail with the existing inline-error path, but let the subtitle inform the user up-front.

**Files:**
- Modify: `app/src/components/BackupBanner.svelte`
- Modify: `app/src/components/ArticleBackupBanner.svelte`

- [ ] **Step 1: Update `BackupBanner.svelte`**

Add the import in the `<script>` block:

```ts
import { describeAvailableImageBackend } from '$lib/describe-backend';
```

Add a state variable:

```ts
  let backendDesc: string | null = null;
```

Update `onMount` to also load the backend description:

```ts
  onMount(async () => {
    prefsAllow = await shouldShowBackupBanner('images');
    backendDesc = await describeAvailableImageBackend();
  });
```

In the template, ABOVE the existing `<div class="backup-banner__actions">`, add a subtitle paragraph:

```svelte
    <p class="backup-banner__sub">
      {#if backendDesc}
        Will use {backendDesc}.
      {:else}
        No backup method is available — set up the local helper or a custom Cloudflare Worker first (Settings → Backup → Advanced).
      {/if}
    </p>
```

Add the corresponding CSS rule inside the existing `<style>` block (alongside the other `.backup-banner__*` rules):

```css
  .backup-banner__sub {
    flex-basis: 100%;
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.75;
  }
```

- [ ] **Step 2: Update `ArticleBackupBanner.svelte`**

The article banner already has a hard-coded subtitle line that says "Article backup needs the local bsky-saves helper." Make it dynamic based on actual helper status.

Add the import:

```ts
import { describeArticleBackend } from '$lib/describe-backend';
```

Add state:

```ts
  let articleBackendStatus: { available: boolean; description: string } = {
    available: false,
    description: 'the local helper is not running',
  };
```

Update `onMount`:

```ts
  onMount(async () => {
    prefsAllow = await shouldShowBackupBanner('articles');
    articleBackendStatus = await describeArticleBackend();
  });
```

Replace the existing hard-coded subtitle line in the template:

Find:
```svelte
    <p class="article-banner__sub">
      Article backup needs the local bsky-saves helper.
    </p>
```

Replace with:
```svelte
    <p class="article-banner__sub">
      {#if articleBackendStatus.available}
        Will use {articleBackendStatus.description}.
      {:else}
        Article backup needs the local bsky-saves helper — currently {articleBackendStatus.description}.
      {/if}
    </p>
```

- [ ] **Step 3: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings, 164/164 tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(banners): show which backend will be used in subtitle"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors, 0 warnings. 164/164 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

After Plan 14, the GUI is honest about which backend will fire BEFORE the user clicks. Settings labels and banner subtitles both use the same description format, sourced from the same helper.

Remaining candidates:
- **Plan 15**: in-app step-by-step custom-proxy setup guide (the "templates/cf-worker reference" replacement).
- **Plan 16**: Show Details modal for backup failures.
- **Plan 17**: Banner sequencing (image first, article waits).
- **Plan 18**: PostFocus per-post backup status footer.
- **Plan 19**: Cf-worker article extraction endpoint (Mozilla Readability).
