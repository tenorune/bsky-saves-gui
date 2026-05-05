# Plan 26: BackupRow + banner UX polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Five UX fixes from real-world testing of Plan 25.

1. Article banner: drop the trailing `Save your own copy.` from body copy.
2. When no backend is available, swap the primary CTA from `Save my own copy` to `Set up a backend` (opens setup modal) — in both the article banner and Settings → Backup rows. Drop the now-redundant "Set up a backend" inline link in the banner sub-text and in the BackupRow status line.
3. Show a domain title (`Images` / `Articles`) in `BackupRow` when `mode="settings"`.
4. Always include backend info in the BackupRow status line (`… · using the local helper`), including in the done/running/cancelled states.
5. Add transient "✓ Done" feedback after a Save click so re-clicking when everything's already saved gives a visible confirmation.

**Architecture:** Update `buildBackupStatusLine` to drop the inline-link descriptor and to append backend info in non-idle states. Update `BackupRow.svelte` to render an h4 in settings mode, swap the primary button when backend is null, await run completion to surface a transient confirmation. Update `ArticleBackupBanner.svelte` to trim body copy, swap its primary button when no backend, and drop the inline link from sub-text.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `25787d4` or later.

---

## File structure

**Modified:**
- `app/src/lib/backup-status-line.ts` — append backend info in all states; drop the `link` field on `BackupStatusLine` (no more inline setup-link in the status line).
- `app/src/lib/backup-status-line.test.ts` — update assertions to match.
- `app/src/components/BackupRow.svelte` — domain title in settings mode; primary-button swap when no backend; transient "✓ Done" confirmation.
- `app/src/components/ArticleBackupBanner.svelte` — trim body copy; primary-button swap when no backend; drop inline link from sub-text.

---

## Task 1: Status line includes backend info; drop the inline-setup link

**Files:**
- Modify: `app/src/lib/backup-status-line.ts`
- Modify: `app/src/lib/backup-status-line.test.ts`

- [ ] **Step 1: Update the failing tests**

Replace the existing test cases in `app/src/lib/backup-status-line.test.ts` with these (delete the old contents inside `describe` and paste the new set):

```ts
import { describe, expect, it } from 'vitest';
import { buildBackupStatusLine } from './backup-status-line';

const idle = { status: 'idle' as const, total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] };

describe('buildBackupStatusLine', () => {
  it('idle + backend available shows "would use ..."', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: idle,
      backendDescription: 'the local helper (bsky-saves 0.3.0)',
    });
    expect(r.text).toBe('Not yet saved · would use the local helper (bsky-saves 0.3.0)');
  });

  it('idle + no backend reads "no backend available" with no inline link', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: idle,
      backendDescription: null,
    });
    expect(r.text).toBe('Not yet saved · no backend available');
  });

  it('running appends backend info', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'running', total: 47, fetched: 11, skipped: 1, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Saving 12 of 47 images… · using the local helper');
  });

  it('done with no failures appends backend info', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 5, fetched: 5, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('5 of 5 images saved · using the local helper');
  });

  it('done with failures appends backend info', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: {
        status: 'done', total: 5, fetched: 3, skipped: 0, failed: 2,
        failures: [{ url: 'a', reason: 'x' }, { url: 'b', reason: 'y' }],
      },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('3 of 5 images saved (2 failed) · using the local helper');
  });

  it('cancelled appends backend info', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: { status: 'cancelled', total: 10, fetched: 4, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Stopped at 4 of 10 articles · using the local helper');
  });

  it('done without backend description omits the suffix', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 5, fetched: 5, skipped: 0, failed: 0, failures: [] },
      backendDescription: null,
    });
    expect(r.text).toBe('5 of 5 images saved');
  });

  it('uses singular noun when total === 1', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 1, fetched: 1, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('1 of 1 image saved · using the local helper');
  });

  it('article noun', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: { status: 'running', total: 3, fetched: 1, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Saving 1 of 3 articles… · using the local helper');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run app/src/lib/backup-status-line.test.ts
```

Expected: failures.

- [ ] **Step 3: Update `app/src/lib/backup-status-line.ts`**

Replace the file contents with:

```ts
import type { HydrationProgress } from './hydration-state';

export interface BackupStatusLineInput {
  readonly domain: 'images' | 'articles';
  readonly hydration: HydrationProgress;
  /** Description string from describe-backend; null when no backend is available. */
  readonly backendDescription: string | null;
}

export interface BackupStatusLine {
  readonly text: string;
}

function noun(domain: 'images' | 'articles', total: number): string {
  if (domain === 'images') return total === 1 ? 'image' : 'images';
  return total === 1 ? 'article' : 'articles';
}

function withBackend(base: string, description: string | null): string {
  if (!description) return base;
  return `${base} · using ${description}`;
}

export function buildBackupStatusLine(input: BackupStatusLineInput): BackupStatusLine {
  const { domain, hydration, backendDescription } = input;
  const succeeded = hydration.fetched + hydration.skipped;

  if (hydration.status === 'idle' || hydration.total === 0) {
    if (backendDescription === null) {
      return { text: 'Not yet saved · no backend available' };
    }
    return { text: `Not yet saved · would use ${backendDescription}` };
  }

  if (hydration.status === 'running') {
    return {
      text: withBackend(
        `Saving ${succeeded} of ${hydration.total} ${noun(domain, hydration.total)}…`,
        backendDescription,
      ),
    };
  }

  if (hydration.status === 'cancelled') {
    return {
      text: withBackend(
        `Stopped at ${succeeded} of ${hydration.total} ${noun(domain, hydration.total)}`,
        backendDescription,
      ),
    };
  }

  // done
  if (hydration.failed > 0) {
    return {
      text: withBackend(
        `${succeeded} of ${hydration.total} ${noun(domain, hydration.total)} saved (${hydration.failed} failed)`,
        backendDescription,
      ),
    };
  }
  return {
    text: withBackend(
      `${succeeded} of ${hydration.total} ${noun(domain, hydration.total)} saved`,
      backendDescription,
    ),
  };
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/backup-status-line.test.ts
```

Expected: 0 errors, 0 warnings; 9/9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/backup-status-line.ts app/src/lib/backup-status-line.test.ts
git commit -m "feat(backup-status-line): include backend info in all states; drop inline link"
```

DO NOT push.

---

## Task 2: BackupRow — domain title, no-backend CTA swap, "✓ Done" feedback

**Files:**
- Modify: `app/src/components/BackupRow.svelte`

The component already imports `CustomProxySetupModal` and has a `setupOpen` state. We're now using that for the primary CTA when there's no backend, and adding a domain title + transient confirmation.

- [ ] **Step 1: Update the script section**

Open `app/src/components/BackupRow.svelte`. The current script imports the stores and helpers; we need to add a `confirmation` state that holds a transient message after a successful run, and a helper to wait for the next done/cancelled transition. Replace the entire `<script>` block with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { imageHydration, articleHydration, type HydrationProgress } from '$lib/hydration-state';
  import { startImageBackup, cancelImageBackup } from '$lib/start-image-backup';
  import { startArticleBackup, cancelArticleBackup } from '$lib/start-article-backup';
  import { describeAvailableImageBackend, describeArticleBackend } from '$lib/describe-backend';
  import { loadBackupPrefs, setBackupDontAsk, type BackupPrefs } from '$lib/backup-prefs';
  import { buildBackupStatusLine } from '$lib/backup-status-line';
  import BackupFailuresModal from './BackupFailuresModal.svelte';
  import CustomProxySetupModal from './CustomProxySetupModal.svelte';

  export let domain: 'images' | 'articles';
  export let inventory: unknown;
  export let mode: 'library' | 'settings';

  let backupPrefs: BackupPrefs | null = null;
  let backendDescription: string | null = null;
  let busy = false;
  let errorMessage = '';
  let failuresOpen = false;
  let setupOpen = false;
  let confirmation = '';

  $: store = domain === 'images' ? imageHydration : articleHydration;
  $: hydration = $store as HydrationProgress;
  $: status = hydration.status;

  $: dontAsk = backupPrefs
    ? domain === 'images'
      ? backupPrefs.images.dontAsk
      : backupPrefs.articles.dontAsk
    : false;

  $: line = buildBackupStatusLine({ domain, hydration, backendDescription });

  $: visible = mode === 'settings' || status !== 'idle';

  $: failedFailures = hydration.failures.map((f) => ({
    ...f,
    type: domain === 'images' ? ('image' as const) : ('article' as const),
  }));

  $: title = domain === 'images' ? 'Images' : 'Articles';
  $: backendAvailable = backendDescription !== null;

  async function refreshBackend() {
    if (domain === 'images') {
      backendDescription = await describeAvailableImageBackend();
    } else {
      const r = await describeArticleBackend();
      backendDescription = r.available ? r.description : null;
    }
  }

  async function reloadPrefs() {
    backupPrefs = await loadBackupPrefs();
  }

  onMount(async () => {
    await reloadPrefs();
    await refreshBackend();
  });

  $: void (async () => {
    void hydration.status;
    await refreshBackend();
  })();

  function showConfirmation(message: string) {
    confirmation = message;
    setTimeout(() => {
      if (confirmation === message) confirmation = '';
    }, 2500);
  }

  function waitForRunCompletion(): Promise<HydrationProgress> {
    const s = domain === 'images' ? imageHydration : articleHydration;
    return new Promise((resolve) => {
      let firstCall = true;
      const unsub = s.subscribe((current) => {
        // Skip the synchronous initial callback Svelte fires on subscribe.
        if (firstCall) {
          firstCall = false;
          return;
        }
        if (current.status === 'done' || current.status === 'cancelled') {
          unsub();
          resolve(current);
        }
      });
    });
  }

  async function handleStart() {
    if (busy || status === 'running') return;
    errorMessage = '';
    busy = true;
    try {
      const result = domain === 'images'
        ? await startImageBackup(inventory)
        : await startArticleBackup(inventory);
      if (!result.started) {
        errorMessage = result.reason ?? 'Could not start backup.';
        return;
      }
      await reloadPrefs();
      const final = await waitForRunCompletion();
      if (final.status === 'cancelled') {
        showConfirmation('✓ Stopped');
      } else if (final.fetched === 0 && final.failed === 0) {
        showConfirmation('✓ Already up to date');
      } else if (final.fetched > 0 && final.failed === 0) {
        showConfirmation('✓ Done');
      }
    } finally {
      busy = false;
    }
  }

  function handleStop() {
    if (domain === 'images') cancelImageBackup();
    else cancelArticleBackup();
  }

  async function handleToggleDontAsk(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setBackupDontAsk(domain, checked);
    await reloadPrefs();
  }

  function dismissError() {
    errorMessage = '';
  }
</script>
```

- [ ] **Step 2: Update the template**

Replace the `<div class="backup-row">…</div>` block with:

```svelte
{#if visible}
  <div class="backup-row">
    {#if mode === 'settings'}
      <h4 class="backup-row__title">{title}</h4>
    {/if}

    <p class="backup-row__line">
      {line.text}
      {#if status === 'done' && hydration.failed > 0}
        (<button
          type="button"
          class="backup-row__failed-link"
          on:click={() => (failuresOpen = true)}
        >{hydration.failed} failed</button>)
      {/if}
      {#if confirmation}
        <span class="backup-row__confirmation">{confirmation}</span>
      {/if}
    </p>

    {#if mode === 'settings'}
      <div class="backup-row__actions">
        {#if !backendAvailable}
          <button type="button" on:click={() => (setupOpen = true)}>Set up a backend</button>
        {:else if status === 'running'}
          <button type="button" on:click={handleStop}>Stop</button>
        {:else}
          <button type="button" on:click={handleStart} disabled={busy}>Save my own copy</button>
        {/if}
        <label class="backup-row__hide">
          <input type="checkbox" checked={dontAsk} on:change={handleToggleDontAsk} />
          <span>Hide reminder</span>
        </label>
      </div>
    {/if}

    {#if errorMessage}
      <div class="backup-row__error" role="alert">
        <span>{errorMessage}</span>
        <button type="button" class="backup-row__dismiss" on:click={dismissError}>Dismiss</button>
      </div>
    {/if}
  </div>
{/if}

<BackupFailuresModal
  open={failuresOpen}
  failures={failedFailures}
  {inventory}
  title={domain === 'images' ? 'Image backup failures' : 'Article backup failures'}
  on:close={() => (failuresOpen = false)}
/>
<CustomProxySetupModal
  open={setupOpen}
  on:close={() => (setupOpen = false)}
  on:change={refreshBackend}
/>
```

- [ ] **Step 3: Add CSS for the title and confirmation**

In the `<style>` block, append:

```css
  .backup-row__title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .backup-row__confirmation {
    margin-left: 0.4rem;
    color: color-mix(in oklab, green 70%, CanvasText);
    font-weight: 500;
    font-size: 0.85rem;
  }
```

- [ ] **Step 4: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/BackupRow.svelte
git commit -m "feat(BackupRow): domain title; no-backend CTA swap; transient run-complete confirmation"
```

DO NOT push.

---

## Task 3: Article banner — trim body, swap CTA when no backend

**Files:**
- Modify: `app/src/components/ArticleBackupBanner.svelte`

- [ ] **Step 1: Trim the body copy**

Find:

```svelte
    <p class="article-banner__text">
      {articleCount} of your saves link to articles. Save the full article
      text so it doesn't disappear if the source goes away. Save your own copy.
    </p>
```

Replace with (drop the trailing `Save your own copy.`):

```svelte
    <p class="article-banner__text">
      {articleCount} of your saves link to articles. Save the full article
      text so it doesn't disappear if the source goes away.
    </p>
```

- [ ] **Step 2: Drop the inline setup-link from sub-text**

Find the existing sub-text block:

```svelte
    <p class="article-banner__sub">
      {#if articleBackendStatus.available}
        Will use {articleBackendStatus.description}.
      {:else}
        Article backup needs the local bsky-saves helper or a custom Cloudflare
        Worker with article extraction.
        <button
          type="button"
          class="article-banner__inline-link"
          on:click={() => (setupOpen = true)}
        >Set up a backend</button>
      {/if}
    </p>
```

Replace with (no inline link; the primary button does the action):

```svelte
    <p class="article-banner__sub">
      {#if articleBackendStatus.available}
        Will use {articleBackendStatus.description}.
      {:else}
        Article backup needs the local bsky-saves helper or a custom Cloudflare
        Worker with article extraction.
      {/if}
    </p>
```

- [ ] **Step 3: Swap the primary button when no backend**

Find the primary button:

```svelte
      <button
        type="button"
        class="article-banner__primary"
        on:click={handleSave}
        disabled={busy}
      >
        Save my own copy
      </button>
```

Replace with:

```svelte
      {#if articleBackendStatus.available}
        <button
          type="button"
          class="article-banner__primary"
          on:click={handleSave}
          disabled={busy}
        >
          Save my own copy
        </button>
      {:else}
        <button
          type="button"
          class="article-banner__primary"
          on:click={() => (setupOpen = true)}
        >
          Set up a backend
        </button>
      {/if}
```

The existing `setupOpen` state and `<CustomProxySetupModal>` mount (added in Plan 25 Task 6) are unchanged — they're still used.

- [ ] **Step 4: Remove the now-unused `.article-banner__inline-link` CSS**

In the `<style>` block, remove the rule:

```css
  .article-banner__inline-link {
    font: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
```

- [ ] **Step 5: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/ArticleBackupBanner.svelte
git commit -m "feat(ArticleBackupBanner): trim body; swap primary CTA when no backend"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run the full test matrix + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## Self-Review Checklist

- `buildBackupStatusLine` always appends `· using {description}` in non-idle states when backend is known; idle states keep `would use` / `no backend available` wording.
- `BackupRow.svelte` shows an `<h4>` domain title only in `mode="settings"`.
- When `backendDescription` is null, the primary button reads `Set up a backend` and opens the existing setup modal.
- After Save click resolves and the run reaches `done` or `cancelled`, a transient `✓ Done` / `✓ Already up to date` / `✓ Stopped` message renders for ~2.5s next to the status line.
- `ArticleBackupBanner.svelte` body no longer ends with `Save your own copy.` and the no-backend sub-text has no inline link.
- Article banner primary button reads `Set up a backend` when `articleBackendStatus.available === false`.
- Three commits, in order.
- `pnpm check && pnpm test && pnpm build` clean.
