# Plan 10: Article-backup UX (Settings row, banner, status row)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Surface the Plan 9 article-backup engine in the GUI so users can trigger and observe it without DevTools. Three small UX additions:

1. **Articles row in Settings → Backup** — mirrors the Images row from Plan 8: status text, Disable button when enabled, "Set up article backup" trigger when not, "Don't ask me about article backup" toggle.
2. **`ArticleBackupBanner.svelte`** — Library banner for article discovery. Same shape as `BackupBanner` (Plan 7) but for articles. Mounted in `Library.svelte` next to the existing image banner.
3. **`BackupStatusRow.svelte` extension** — show article counters alongside image counters. Each feature renders only when its hydration state is non-idle.

**Out of scope (later plans):**
- Banner sequencing per the spec's "image first, article waits" rule. Both banners visible if both applicable; user dismisses in any order. Sequencing is a small follow-up if user reports it as confusing — the engineering cost (cross-component coordination of pref state) isn't worth it without that signal.
- PostFocus footer (per-post backup status).
- Show Details modal (failures list).
- Refactoring `BackupBanner` and `ArticleBackupBanner` into a generic component.

**Tech Stack:** Svelte 4, TypeScript 5. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` — sections "Article-backup banner", "Library page changes", "Settings page".

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `61c46e0` (Plan 9 final commit) or later.

---

## Task 1: Articles row in Settings → Backup

Extend the existing Backup section in `Settings.svelte` with an Articles row mirroring the Images row. Add corresponding state, reactive declarations, handlers, and template markup.

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Extend imports**

In `app/src/routes/Settings.svelte`'s `<script>` block, update the `start-image-backup` import line to also pull from `start-article-backup`:

After the existing `import { cancelImageBackup } from '$lib/start-image-backup';`, add:

```ts
import { startArticleBackup, cancelArticleBackup } from '$lib/start-article-backup';
import { extractArticleUrls } from '$lib/extract-article-urls';
```

- [ ] **Step 2: Add article-related state and reactive declarations**

In the `<script>` block, find the existing `$:` block that derives `imagesEnabled`, `imagesDontAsk`, `backupSectionVisible`, `helperBackend`, `workerBackend`, `imagesBackendLabel`. Update `backupSectionVisible` to also consider article prefs, and add article-specific declarations:

```ts
  $: imagesEnabled = backupPrefs?.images.enabled ?? false;
  $: imagesDontAsk = backupPrefs?.images.dontAsk ?? false;
  $: articlesEnabled = backupPrefs?.articles.enabled ?? false;
  $: articlesDontAsk = backupPrefs?.articles.dontAsk ?? false;
  $: backupSectionVisible =
    imagesEnabled ||
    imagesDontAsk ||
    (backupPrefs?.images.snoozeUntil ?? null) !== null ||
    articlesEnabled ||
    articlesDontAsk ||
    (backupPrefs?.articles.snoozeUntil ?? null) !== null;
  $: helperBackend = detectedBackends.find((b) => b.kind === 'helper');
  $: workerBackend = detectedBackends.find((b) => b.kind === 'user-worker');
  $: imagesBackendLabel = imagesEnabled
    ? helperBackend
      ? `using local helper (bsky-saves ${helperBackend.version})`
      : workerBackend
        ? 'using your custom Cloudflare Worker'
        : 'no backend reachable right now'
    : 'not set up';
  $: articlesBackendLabel = articlesEnabled
    ? helperBackend
      ? `using local helper (bsky-saves ${helperBackend.version})`
      : 'no helper running'
    : 'not set up';
```

(Articles can ONLY use the helper backend, so the label is simpler than images'.)

- [ ] **Step 3: Add article-specific handlers**

Below the existing `handleSaveWorker` and `handleClearWorker` handlers, add:

```ts
  let articleSetupError = '';

  async function handleSetUpArticles() {
    if (backupPrefs === null) return;
    articleSetupError = '';
    const inventoryState = await import('$lib/inventory-loader');
    const state = inventoryState.inventoryState;
    let inv: unknown = null;
    state.subscribe((s) => {
      if (s.status === 'ready') inv = s.inventory;
    })();
    if (!inv) {
      articleSetupError = 'No library loaded.';
      return;
    }
    const result = await startArticleBackup(inv);
    if (!result.started) {
      articleSetupError = result.reason ?? 'Could not start article backup.';
      return;
    }
    await reloadBackupPrefs();
  }

  async function handleDisableArticles() {
    cancelArticleBackup();
    await setBackupEnabled('articles', false);
    await reloadBackupPrefs();
  }

  async function handleToggleArticlesDontAsk(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setBackupDontAsk('articles', checked);
    await reloadBackupPrefs();
  }
```

The `handleSetUpArticles` is a bit ungainly because we need the current inventory from the inventoryState store synchronously. Use `get` instead of subscribe-and-immediately-unsubscribe — that's the idiomatic Svelte pattern. Update the import:

Find:
```ts
import { get } from 'svelte/store';
```

(It's already imported.) Now in `handleSetUpArticles`, replace the dynamic-import dance with:

```ts
  async function handleSetUpArticles() {
    if (backupPrefs === null) return;
    articleSetupError = '';
    const state = get(inventoryState);
    if (state.status !== 'ready') {
      articleSetupError = 'No library loaded.';
      return;
    }
    const result = await startArticleBackup(state.inventory);
    if (!result.started) {
      articleSetupError = result.reason ?? 'Could not start article backup.';
      return;
    }
    await reloadBackupPrefs();
  }
```

- [ ] **Step 4: Render the Articles row in the template**

In the Backup section's template, find the existing Images row:

```svelte
      <div class="settings-row">
        <strong>Images:</strong>
        <span>{imagesBackendLabel}</span>
        {#if imagesEnabled}
          <button type="button" on:click={handleDisableImages}>Disable</button>
        {/if}
      </div>

      <label class="checkbox">
        <input
          type="checkbox"
          checked={imagesDontAsk}
          on:change={handleToggleDontAsk}
        />
        <span>Don't ask me about image backup</span>
      </label>
```

Below the image's "Don't ask me" checkbox and BEFORE the existing `<details class="advanced-toggle">`, insert:

```svelte
      <div class="settings-row">
        <strong>Articles:</strong>
        <span>{articlesBackendLabel}</span>
        {#if articlesEnabled}
          <button type="button" on:click={handleDisableArticles}>Disable</button>
        {:else}
          <button type="button" on:click={handleSetUpArticles}>Set up article backup</button>
        {/if}
      </div>

      {#if articleSetupError}
        <p class="error" role="alert">{articleSetupError}</p>
      {/if}

      <label class="checkbox">
        <input
          type="checkbox"
          checked={articlesDontAsk}
          on:change={handleToggleArticlesDontAsk}
        />
        <span>Don't ask me about article backup</span>
      </label>
```

- [ ] **Step 5: Update the Backup section's intro paragraph**

Find:

```svelte
      <p class="help">
        Save your own copy of images so they keep showing up even if Bluesky
        changes. Articles will be added in a future update.
      </p>
```

Replace with:

```svelte
      <p class="help">
        Save your own copies of images and linked articles so they keep showing
        up even if Bluesky or the source site changes. Article backup needs the
        local bsky-saves helper.
      </p>
```

- [ ] **Step 6: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings. 152/152 tests pass. Both bundles build.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): articles row in Backup section"
```

DO NOT push.

---

## Task 2: `ArticleBackupBanner.svelte` + Library mount

A Library-page banner for article discovery. Same shape and visibility logic as `BackupBanner.svelte` (Plan 7), but for articles.

**Files:**
- Create: `app/src/components/ArticleBackupBanner.svelte`
- Modify: `app/src/routes/Library.svelte`

- [ ] **Step 1: Implement the article banner**

Create `app/src/components/ArticleBackupBanner.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { extractArticleUrls } from '$lib/extract-article-urls';
  import {
    shouldShowBackupBanner,
    snoozeBackupPrompt,
    setBackupDontAsk,
  } from '$lib/backup-prefs';
  import { articleHydration } from '$lib/hydration-state';
  import { startArticleBackup } from '$lib/start-article-backup';

  /** Inventory the banner observes for article content. Required. */
  export let inventory: unknown;

  let prefsAllow = false; // false until we've loaded prefs once
  let busy = false;
  let startError = '';

  onMount(async () => {
    prefsAllow = await shouldShowBackupBanner('articles');
  });

  async function handleSave() {
    if (busy) return;
    busy = true;
    startError = '';
    try {
      const result = await startArticleBackup(inventory);
      if (!result.started) {
        startError = result.reason ?? 'Could not start article backup.';
      }
    } finally {
      busy = false;
    }
  }

  async function handleSnooze() {
    await snoozeBackupPrompt('articles');
    prefsAllow = false;
  }

  async function handleDontAsk() {
    await setBackupDontAsk('articles', true);
    prefsAllow = false;
  }

  $: articleCount = extractArticleUrls(inventory).length;
  $: status = $articleHydration.status;
  $: visible = prefsAllow && articleCount > 0 && status === 'idle';
</script>

{#if visible}
  <div class="article-banner" role="region" aria-label="Article backup suggestion">
    <p class="article-banner__text">
      {articleCount} of your saves link to articles. Save the full article
      text so it doesn't disappear if the source goes away. Set up backup →
    </p>
    <p class="article-banner__sub">
      Article backup needs the local bsky-saves helper.
    </p>
    <div class="article-banner__actions">
      <button
        type="button"
        class="article-banner__primary"
        on:click={handleSave}
        disabled={busy}
      >
        Set up backup →
      </button>
      <button type="button" class="article-banner__link" on:click={handleSnooze}>
        Remind me later
      </button>
      <button type="button" class="article-banner__link" on:click={handleDontAsk}>
        Don't ask me again
      </button>
    </div>
    {#if startError}
      <p class="article-banner__error" role="alert">{startError}</p>
    {/if}
  </div>
{/if}

<style>
  .article-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 8px;
    background: color-mix(in oklab, CanvasText 6%, Canvas);
  }
  .article-banner__text {
    margin: 0;
    flex: 1 1 18rem;
    font-size: 0.95rem;
  }
  .article-banner__sub {
    margin: 0;
    flex-basis: 100%;
    font-size: 0.85rem;
    opacity: 0.75;
  }
  .article-banner__actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .article-banner__primary {
    font: inherit;
    font-weight: 600;
    padding: 0.4rem 0.85rem;
    border: 1px solid color-mix(in oklab, CanvasText 30%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .article-banner__primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .article-banner__link {
    font: inherit;
    font-size: 0.875rem;
    background: none;
    border: 0;
    padding: 0.25rem 0.4rem;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    opacity: 0.85;
  }
  .article-banner__link:hover {
    opacity: 1;
  }
  .article-banner__error {
    flex-basis: 100%;
    margin: 0;
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
</style>
```

- [ ] **Step 2: Mount the banner in Library**

Open `app/src/routes/Library.svelte`. Add the import after the existing `BackupBanner` import:

```ts
import ArticleBackupBanner from '../components/ArticleBackupBanner.svelte';
```

In the `'ready'` branch of the template, find:

```svelte
  {:else}
    <BackupBanner inventory={$inventoryState.inventory} />
    <BackupStatusRow inventory={$inventoryState.inventory} />
    <LibraryView inventory={$inventoryState.inventory} onSelectPost={open} />
  {/if}
```

Insert `ArticleBackupBanner` BELOW the image banner and ABOVE the status row:

```svelte
  {:else}
    <BackupBanner inventory={$inventoryState.inventory} />
    <ArticleBackupBanner inventory={$inventoryState.inventory} />
    <BackupStatusRow inventory={$inventoryState.inventory} />
    <LibraryView inventory={$inventoryState.inventory} onSelectPost={open} />
  {/if}
```

- [ ] **Step 3: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings. 152/152 tests pass. Both bundles build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(article-banner): just-in-time article-backup discovery banner"
```

DO NOT push.

---

## Task 3: Extend `BackupStatusRow` with article state

Add article counters alongside image counters. Each feature's content renders only when its hydration state is non-idle (so the row doesn't double up when both are idle — banners handle discovery).

**Files:**
- Modify: `app/src/components/BackupStatusRow.svelte`

- [ ] **Step 1: Update the component**

Open `app/src/components/BackupStatusRow.svelte`. Add imports for the article paths:

```ts
  import { articleHydration } from '$lib/hydration-state';
  import { startArticleBackup, cancelArticleBackup } from '$lib/start-article-backup';
```

Add reactive declarations and handlers mirroring the image ones. Below the existing `$: succeeded = fetched + skipped;` line, add:

```ts
  $: aStatus = $articleHydration.status;
  $: aTotal = $articleHydration.total;
  $: aFetched = $articleHydration.fetched;
  $: aSkipped = $articleHydration.skipped;
  $: aFailed = $articleHydration.failed;
  $: aSucceeded = aFetched + aSkipped;

  let articleBusy = false;
  let articleErrorMessage = '';

  async function handleStartArticles() {
    if (articleBusy) return;
    articleErrorMessage = '';
    articleBusy = true;
    try {
      const result = await startArticleBackup(inventory);
      if (!result.started) {
        articleErrorMessage = result.reason ?? 'Could not start article backup.';
      }
    } finally {
      articleBusy = false;
    }
  }

  function handleStopArticles() {
    cancelArticleBackup();
  }

  function dismissArticleError() {
    articleErrorMessage = '';
  }
```

In the template, replace the entire existing `<div class="backup-status">` block. The new structure renders the image block (kept as-is in spirit) AND a new article block, with each feature's content gated on `status !== 'idle'`. Replace:

```svelte
<div class="backup-status">
  {#if errorMessage}
    <div class="backup-status__error" role="alert">
      <span>{errorMessage}</span>
      <button type="button" class="backup-status__dismiss" on:click={dismissError}>Dismiss</button>
    </div>
  {/if}

  {#if status === 'idle'}
    <button
      type="button"
      class="backup-status__primary"
      on:click={handleStart}
      disabled={busy}
    >
      Save my own copy of images
    </button>
  {:else if status === 'running'}
    <p class="backup-status__line">
      Saving images: {succeeded} of {total}
      {#if failed > 0}({failed} failed){/if}
    </p>
    <button type="button" on:click={handleStop}>Stop</button>
  {:else if status === 'done'}
    {#if total === 0}
      <!-- nothing to back up; suppress the row -->
    {:else if failed === 0}
      <p class="backup-status__line">All {total} images saved.</p>
      <button type="button" on:click={handleStart} disabled={busy}>Re-check</button>
    {:else}
      <p class="backup-status__line">
        {succeeded} of {total} images saved ({failed} failed)
      </p>
      <button type="button" on:click={handleStart} disabled={busy}>Retry</button>
    {/if}
  {:else if status === 'cancelled'}
    <p class="backup-status__line">
      Stopped at {succeeded} of {total} images
      {#if failed > 0}({failed} failed){/if}
    </p>
    <button type="button" on:click={handleStart} disabled={busy}>Resume</button>
  {/if}
</div>
```

…with this new structure:

```svelte
{#if status !== 'idle' || aStatus !== 'idle'}
  <div class="backup-status">
    {#if errorMessage}
      <div class="backup-status__error" role="alert">
        <span>{errorMessage}</span>
        <button type="button" class="backup-status__dismiss" on:click={dismissError}>Dismiss</button>
      </div>
    {/if}
    {#if articleErrorMessage}
      <div class="backup-status__error" role="alert">
        <span>{articleErrorMessage}</span>
        <button type="button" class="backup-status__dismiss" on:click={dismissArticleError}>Dismiss</button>
      </div>
    {/if}

    {#if status === 'running'}
      <p class="backup-status__line">
        Saving images: {succeeded} of {total}
        {#if failed > 0}({failed} failed){/if}
      </p>
      <button type="button" on:click={handleStop}>Stop</button>
    {:else if status === 'done' && total > 0}
      {#if failed === 0}
        <p class="backup-status__line">All {total} images saved.</p>
        <button type="button" on:click={handleStart} disabled={busy}>Re-check</button>
      {:else}
        <p class="backup-status__line">
          {succeeded} of {total} images saved ({failed} failed)
        </p>
        <button type="button" on:click={handleStart} disabled={busy}>Retry</button>
      {/if}
    {:else if status === 'cancelled'}
      <p class="backup-status__line">
        Stopped at {succeeded} of {total} images
        {#if failed > 0}({failed} failed){/if}
      </p>
      <button type="button" on:click={handleStart} disabled={busy}>Resume</button>
    {/if}

    {#if aStatus === 'running'}
      <p class="backup-status__line">
        Saving articles: {aSucceeded} of {aTotal}
        {#if aFailed > 0}({aFailed} failed){/if}
      </p>
      <button type="button" on:click={handleStopArticles}>Stop</button>
    {:else if aStatus === 'done' && aTotal > 0}
      {#if aFailed === 0}
        <p class="backup-status__line">All {aTotal} articles saved.</p>
        <button type="button" on:click={handleStartArticles} disabled={articleBusy}>Re-check</button>
      {:else}
        <p class="backup-status__line">
          {aSucceeded} of {aTotal} articles saved ({aFailed} failed)
        </p>
        <button type="button" on:click={handleStartArticles} disabled={articleBusy}>Retry</button>
      {/if}
    {:else if aStatus === 'cancelled'}
      <p class="backup-status__line">
        Stopped at {aSucceeded} of {aTotal} articles
        {#if aFailed > 0}({aFailed} failed){/if}
      </p>
      <button type="button" on:click={handleStartArticles} disabled={articleBusy}>Resume</button>
    {/if}
  </div>
{/if}
```

Note the outer `{#if status !== 'idle' || aStatus !== 'idle'}` — the entire row is hidden when both features are idle. This deliberately removes the idle-state "Save my own copy of images" button (which lived in the row before Plan 8); discovery now happens via banners.

- [ ] **Step 2: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 0 warnings. 152/152 tests pass. Both bundles build.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(BackupStatusRow): show article counters; hide row when both idle"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors, 0 warnings. 152/152 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

After Plan 10, article backup is end-to-end usable from the GUI for users running the bsky-saves helper. The user-facing loop is closed for both features.

Plan 11 candidates (each independently small):
- **PostFocus backup footer** — per-post status under each post in the focus view (e.g. "Article saved ✓" or "3 images saved ✓").
- **Show Details modal** — failures listed with permalinks + reasons, triggered from `BackupStatusRow` when failures > 0.
- **Banner sequencing** — per the design spec's "image first, article waits". A small parent component that decides which of the two banners to show.
- **Cf-worker article-extraction endpoint** — extends `templates/cf-worker/worker.js` with a server-side trafilatura-equivalent so users without a local helper can still hydrate articles. Likely a separate plan since it touches the cf-worker template + repackages the worker JS.
- **Privacy doc rewrite** — the current `docs/privacy.md` is image-focused. Add an article section honestly explaining the helper-only path.
