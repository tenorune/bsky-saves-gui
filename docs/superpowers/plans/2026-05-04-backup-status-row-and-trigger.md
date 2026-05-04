# Plan 6: `BackupStatusRow` + trigger button (image backup end-to-end)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** First end-to-end UX for image backup. Add a status row to the Library page that shows live hydration progress AND a "Save my own copy of images" button that triggers the run. After this plan, a user with a working backend (helper or user-worker) can hydrate images from the GUI in one click and watch the counter tick up.

**Architecture:** Two-layer split (same pattern as Plan 5):

1. `start-image-backup.ts` — small helper that owns the run lifecycle: probes backends, refuses to start with a clear reason if none are configured, creates an `AbortController` so the UI can cancel, kicks off `hydrateImages(inventory)` in the background, and exposes `cancelImageBackup()` for the Stop button.
2. `BackupStatusRow.svelte` — Library-page component that subscribes to `imageHydration` and renders one of: the trigger button (when idle), live counter + Stop button (when running), result summary + restart button (when done/cancelled), or an error block (no backend available).
3. `Library.svelte` integration — mount `BackupStatusRow` between the Library header and the feed.

This is **not** the polished UX from the design spec (banners, snooze, Settings Backup section, Show Details modal, PostFocus footer all come in Plan 7+). It's the minimum to prove the engine works end-to-end and give the user a way to actually trigger backup.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest 2. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` "Library page changes" — the status row design. The Plan 6 row is a simplified version pending the full banner-driven flow in Plan 7.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `232445f` (Plan 5 final commit) or later.

---

## Task 1: `start-image-backup.ts` — run-lifecycle helper

A thin module that wraps `hydrateImages` with the controls the UI needs:

- `startImageBackup(inventory): Promise<StartResult>` — probes backends; if none, returns `{started: false, reason: '...'}` without touching the hydration store. If at least one backend exists, sets up an `AbortController`, spawns the hydration in the background (does NOT await it), and returns `{started: true}` immediately.
- `cancelImageBackup(): void` — aborts the controller created by the most recent `startImageBackup` call, if any. Safe to call when no run is active (no-op).

Module-level state (the current `AbortController`) is acceptable here because image hydration is conceptually a singleton operation — only one image-backup run can be in flight at a time. Plan 7+ will likely refactor when articles arrive (parallel image+article runs), but for Plan 6, simplicity wins.

**Files:**
- Create: `app/src/lib/start-image-backup.ts`
- Create: `app/src/lib/start-image-backup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/start-image-backup.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
  const { clearProxyConfig } = await import('./proxy-config');
  await clearProxyConfig();
  const { resetImageHydration } = await import('./hydration-state');
  resetImageHydration();
});

const okPing = {
  ok: true,
  json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: ['fetch-image'] }),
};

describe('startImageBackup', () => {
  it('returns {started: false, reason} when no backend is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch'); // helper probe fails
      }),
    );
    const { startImageBackup } = await import('./start-image-backup');
    const result = await startImageBackup({ saves: [{ images: [{ url: 'https://x/1' }] }] });
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/No backup method/i);
  });

  it('returns {started: true} when a helper is available and starts the loop', async () => {
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing; // backend probe
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          blob: async () => new Blob(['IMG'], { type: 'image/png' }),
        };
      }),
    );
    const { startImageBackup } = await import('./start-image-backup');
    const { imageHydration } = await import('./hydration-state');

    const result = await startImageBackup({
      saves: [{ images: [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }] }],
    });
    expect(result).toEqual({ started: true });

    // Wait for the background loop to finish; total === fetched once it's done.
    await vi.waitUntil(() => get(imageHydration).status === 'done', { timeout: 1000 });
    const final = get(imageHydration);
    expect(final.total).toBe(2);
    expect(final.fetched).toBe(2);
    expect(final.failed).toBe(0);
  });

  it('cancelImageBackup aborts a running loop', async () => {
    // Helper probe + then a fetch that takes a few microtasks (so we can
    // cancel between iterations).
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing;
        await new Promise((r) => setTimeout(r, 5));
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          blob: async () => new Blob(['IMG'], { type: 'image/png' }),
        };
      }),
    );
    const { startImageBackup, cancelImageBackup } = await import('./start-image-backup');
    const { imageHydration } = await import('./hydration-state');

    const result = await startImageBackup({
      saves: [
        { images: [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }, { url: 'https://x/3.jpg' }] },
      ],
    });
    expect(result.started).toBe(true);

    // Wait until at least one image has been processed, then cancel.
    await vi.waitUntil(() => get(imageHydration).fetched >= 1, { timeout: 1000 });
    cancelImageBackup();

    await vi.waitUntil(() => get(imageHydration).status === 'cancelled', { timeout: 1000 });
    const final = get(imageHydration);
    expect(final.status).toBe('cancelled');
    expect(final.fetched).toBeLessThan(3);
  });

  it('cancelImageBackup is a safe no-op when nothing is running', async () => {
    const { cancelImageBackup } = await import('./start-image-backup');
    expect(() => cancelImageBackup()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test start-image-backup`

- [ ] **Step 3: Implement the module**

Create `app/src/lib/start-image-backup.ts`:

```ts
// Run-lifecycle helper for image backup. Wraps the Plan 4 image-hydrator
// with the controls the UI needs:
//
// - startImageBackup(inventory): probes backends. Refuses to start with a
//   reason when none are configured. Otherwise spawns the hydration loop
//   in the background and returns immediately.
//
// - cancelImageBackup(): aborts the most recent run, if any.
//
// Module-level AbortController is fine here — image hydration is a singleton
// operation. Plan 7+ may refactor when article hydration arrives.

import { detectBackends } from './image-fetcher';
import { hydrateImages } from './image-hydrator';

export interface StartResult {
  readonly started: boolean;
  readonly reason?: string;
}

let activeController: AbortController | null = null;

export async function startImageBackup(inventory: unknown): Promise<StartResult> {
  const backends = await detectBackends();
  if (backends.length === 0) {
    return {
      started: false,
      reason:
        'No backup method is set up. Install bsky-saves locally (run `bsky-saves serve`) ' +
        'or configure a Cloudflare Worker proxy in Settings.',
    };
  }

  const controller = new AbortController();
  activeController = controller;

  // Fire-and-forget. The hydration loop updates imageHydration as it goes.
  // We clear activeController when this run finishes so cancelImageBackup
  // doesn't try to abort a stale controller.
  void hydrateImages(inventory, { signal: controller.signal }).finally(() => {
    if (activeController === controller) activeController = null;
  });

  return { started: true };
}

export function cancelImageBackup(): void {
  activeController?.abort();
}
```

- [ ] **Step 4: Run tests — confirm all 4 pass**

Run: `pnpm test start-image-backup`

Expected: 4/4 passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 118 → 122.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(start-image-backup): run lifecycle helper with cancel"
```

DO NOT push.

---

## Task 2: `BackupStatusRow.svelte` — Library-page status component

Renders one of four states based on `imageHydration`:

1. **Idle** (status === 'idle'): a single button "Save my own copy of images". Click → calls `startImageBackup(inventory)`. If `started: false`, shows the reason inline.
2. **Running** (status === 'running'): "Images: X of Y saved" + Stop button.
3. **Done** (status === 'done', total > 0): "All N images saved" or "X of N images saved (Y failed)". Plus a "Re-check" button that re-runs `startImageBackup` (to pick up new images added since last run).
4. **Cancelled** (status === 'cancelled'): "Stopped at X of Y" + Resume button (calls `startImageBackup` again — uncached URLs get retried).

Hidden entirely when no inventory is loaded (consumer's responsibility — Library only mounts the row when there's an inventory).

If `startImageBackup` returns `{started: false}`, the component shows the `reason` text in a small error block until the user dismisses it.

**Files:**
- Create: `app/src/components/BackupStatusRow.svelte`

- [ ] **Step 1: Implement the component**

Create `app/src/components/BackupStatusRow.svelte`:

```svelte
<script lang="ts">
  import { imageHydration } from '$lib/hydration-state';
  import { startImageBackup, cancelImageBackup } from '$lib/start-image-backup';

  /** Inventory the backup operates on. Required. */
  export let inventory: unknown;

  let busy = false;
  let errorMessage = '';

  async function handleStart() {
    if (busy) return;
    errorMessage = '';
    busy = true;
    try {
      const result = await startImageBackup(inventory);
      if (!result.started) {
        errorMessage = result.reason ?? 'Could not start backup.';
      }
    } finally {
      busy = false;
    }
  }

  function handleStop() {
    cancelImageBackup();
  }

  function dismissError() {
    errorMessage = '';
  }

  $: status = $imageHydration.status;
  $: total = $imageHydration.total;
  $: fetched = $imageHydration.fetched;
  $: skipped = $imageHydration.skipped;
  $: failed = $imageHydration.failed;
  $: succeeded = fetched + skipped;
</script>

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

<style>
  .backup-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 6px;
    background: color-mix(in oklab, CanvasText 4%, Canvas);
    font-size: 0.9rem;
  }
  .backup-status__line {
    margin: 0;
    flex: 1;
  }
  .backup-status__primary {
    font-weight: 600;
  }
  .backup-status button {
    font: inherit;
    padding: 0.35rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .backup-status button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .backup-status__error {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
  .backup-status__dismiss {
    margin-left: auto;
  }
</style>
```

- [ ] **Step 2: Verify type check**

Run: `pnpm check`

Expected: 0 errors (3 tolerated CSS warnings from prior plans).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(BackupStatusRow): Library row with trigger, progress, stop, retry"
```

DO NOT push.

---

## Task 3: Mount `BackupStatusRow` in Library

Wire the row into `Library.svelte`. It should appear between the route header (the existing `<header class="route__header">`) and the feed body, and only when an inventory is loaded.

**Files:**
- Modify: `app/src/routes/Library.svelte`

- [ ] **Step 1: Add the import**

Open `app/src/routes/Library.svelte`. Add this import to the `<script>` block (after the existing `LibraryView` import):

```ts
import BackupStatusRow from '../components/BackupStatusRow.svelte';
```

- [ ] **Step 2: Mount the row in the `'ready'` branch**

Find the existing `{:else}` branch that renders `LibraryView`:

```svelte
  {:else}
    <LibraryView inventory={$inventoryState.inventory} onSelectPost={open} />
  {/if}
```

Change it to render the BackupStatusRow above the LibraryView:

```svelte
  {:else}
    <BackupStatusRow inventory={$inventoryState.inventory} />
    <LibraryView inventory={$inventoryState.inventory} onSelectPost={open} />
  {/if}
```

- [ ] **Step 3: Run check + tests + build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: 0 errors, all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(library): mount BackupStatusRow above the feed"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors (3 pre-existing CSS warnings tolerated). All ~122 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

After Plan 6, image backup is end-to-end usable from the GUI as long as a backend is configured. The UX is bare-bones (one button on the Library, one status row) but functional.

Plan 7 will replace this minimum with the design-spec UX:
- Image-backup banner (snooze/don't-ask, only shows when applicable per `backup-prefs`).
- Setup wizard modal that walks the user through helper install or worker configuration when no backend is available.
- Settings → Backup section (enable/disable, advanced disclosure with custom-worker fields).
- PostFocus backup footer (per-post status).
- Show Details modal listing failures.

After Plan 7, image backup matches the design spec.
