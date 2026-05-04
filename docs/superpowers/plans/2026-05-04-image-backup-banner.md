# Plan 7: Image-backup banner with snooze + don't-ask

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Add the just-in-time discovery banner the design spec calls for. After first fetch, when the library contains images and the user hasn't snoozed or dismissed, the Library page shows a "Save my own copy of images" banner above the existing `BackupStatusRow`. Banner has three actions: primary trigger (calls `startImageBackup`), Remind me later (7-day snooze via `backup-prefs`), Don't ask again (permanent dismiss).

**Architecture:** One new component, two-line Library integration. No new lib modules — reuses Plan 2's `backup-prefs` and Plan 4's `extract-image-urls`.

**Visibility logic** (all four conditions must hold for the banner to render):
1. `extractImageUrls(inventory).length > 0` — there are images to back up.
2. `$imageHydration.status === 'idle'` — no run is active or just completed (avoids stacking with `BackupStatusRow`'s in-progress display).
3. `shouldShowBackupBanner('images')` returns true — neither snoozed nor dismissed via backup-prefs.
4. The user hasn't dismissed or snoozed inside the current page lifetime (we only re-load prefs on mount and after dismiss actions).

**Out of scope (later plans):**
- Setup wizard modal (Plan 8) — banner's primary action calls `startImageBackup` directly; on no-backend, the existing `BackupStatusRow` error block surfaces the reason.
- "Image backup is enabled" preference (Plan 8) — without it, the banner re-shows on page reload after a successful run unless snoozed. Acceptable interim behavior.
- Article-backup banner (Plan 9+).
- PostFocus footer + Show Details modal (Plan 8 or later).

**Tech Stack:** Svelte 4, TypeScript 5. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` — sections "Image-backup banner" and "Permanent dismissals". The Plan 7 implementation matches the spec's banner shape and dismiss model exactly.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `9da3383` (Plan 6 final commit) or later.

---

## Task 1: `BackupBanner.svelte` (image variant)

**Files:**
- Create: `app/src/components/BackupBanner.svelte`

The banner is built specifically for the image-backup case in this plan. It's NOT made generic across features yet — Plan 9 will pull the article path through and we'll factor at that point. Premature abstraction would just lock in the wrong shape.

- [ ] **Step 1: Implement the component**

Create `app/src/components/BackupBanner.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { extractImageUrls } from '$lib/extract-image-urls';
  import {
    shouldShowBackupBanner,
    snoozeBackupPrompt,
    setBackupDontAsk,
  } from '$lib/backup-prefs';
  import { imageHydration } from '$lib/hydration-state';
  import { startImageBackup } from '$lib/start-image-backup';

  /** Inventory the banner observes for image content. Required. */
  export let inventory: unknown;

  let prefsAllow = false; // false until we've loaded prefs once
  let busy = false;

  onMount(async () => {
    prefsAllow = await shouldShowBackupBanner('images');
  });

  async function handleSave() {
    if (busy) return;
    busy = true;
    try {
      // Fire and forget — BackupStatusRow renders the resulting state. If
      // startImageBackup returns {started: false}, BackupStatusRow does NOT
      // see it because the row only displays errors that flow through ITS
      // own handler. To avoid swallowing the error, we surface the reason
      // ourselves below the banner via local state.
      const result = await startImageBackup(inventory);
      if (!result.started) {
        startError = result.reason ?? 'Could not start backup.';
      }
    } finally {
      busy = false;
    }
  }

  let startError = '';

  async function handleSnooze() {
    await snoozeBackupPrompt('images');
    prefsAllow = false;
  }

  async function handleDontAsk() {
    await setBackupDontAsk('images', true);
    prefsAllow = false;
  }

  $: imageCount = extractImageUrls(inventory).length;
  $: status = $imageHydration.status;
  $: visible = prefsAllow && imageCount > 0 && status === 'idle';
</script>

{#if visible}
  <div class="backup-banner" role="region" aria-label="Image backup suggestion">
    <p class="backup-banner__text">
      {imageCount} of your saves include images. They'll work as long as Bluesky keeps
      them online. Save your own copy →
    </p>
    <div class="backup-banner__actions">
      <button
        type="button"
        class="backup-banner__primary"
        on:click={handleSave}
        disabled={busy}
      >
        Save my own copy →
      </button>
      <button type="button" class="backup-banner__link" on:click={handleSnooze}>
        Remind me later
      </button>
      <button type="button" class="backup-banner__link" on:click={handleDontAsk}>
        Don't ask me again
      </button>
    </div>
    {#if startError}
      <p class="backup-banner__error" role="alert">{startError}</p>
    {/if}
  </div>
{/if}

<style>
  .backup-banner {
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
  .backup-banner__text {
    margin: 0;
    flex: 1 1 18rem;
    font-size: 0.95rem;
  }
  .backup-banner__actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .backup-banner__primary {
    font: inherit;
    font-weight: 600;
    padding: 0.4rem 0.85rem;
    border: 1px solid color-mix(in oklab, CanvasText 30%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .backup-banner__primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .backup-banner__link {
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
  .backup-banner__link:hover {
    opacity: 1;
  }
  .backup-banner__error {
    flex-basis: 100%;
    margin: 0;
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
</style>
```

- [ ] **Step 2: Verify type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors (3 tolerated CSS warnings from prior plans). All 122 tests still pass — no test changes in this task.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(BackupBanner): just-in-time image-backup discovery banner"
```

DO NOT push.

---

## Task 2: Mount `BackupBanner` in Library

The banner appears ABOVE `BackupStatusRow` — it's the discovery affordance, status row is the post-discovery affordance.

**Files:**
- Modify: `app/src/routes/Library.svelte`

- [ ] **Step 1: Add the import**

Open `app/src/routes/Library.svelte`. Add this import to the `<script>` block (after the existing `BackupStatusRow` import):

```ts
import BackupBanner from '../components/BackupBanner.svelte';
```

- [ ] **Step 2: Mount the banner above the status row in the `'ready'` branch**

Find the existing `'ready'` branch:

```svelte
  {:else}
    <BackupStatusRow inventory={$inventoryState.inventory} />
    <LibraryView inventory={$inventoryState.inventory} onSelectPost={open} />
  {/if}
```

Insert `BackupBanner` above `BackupStatusRow`:

```svelte
  {:else}
    <BackupBanner inventory={$inventoryState.inventory} />
    <BackupStatusRow inventory={$inventoryState.inventory} />
    <LibraryView inventory={$inventoryState.inventory} onSelectPost={open} />
  {/if}
```

- [ ] **Step 3: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, 122/122 tests, both bundles build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(library): mount BackupBanner above BackupStatusRow"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors (3 pre-existing CSS warnings tolerated). All 122 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

Plan 7 ships banner-driven discovery. The banner fires when the library has images and the user hasn't snoozed (7d) or permanently dismissed it. The button currently just calls `startImageBackup` directly — Plan 8 replaces that with a setup wizard so users without a configured backend get a guided install flow instead of a raw error message.

Plan 8 candidates:
- Setup wizard modal (happy path + first-time path with helper-install instructions and Advanced disclosure for custom worker).
- Settings → Backup section (conditional; mirrors the prefs as toggles; advanced disclosure with proxy URL/secret form).
- "Image backup enabled" preference so banner stops re-showing after first successful enable.
- PostFocus backup footer (per-post status) + Show Details modal.
- Article-backup banner + setup wizard variant.
