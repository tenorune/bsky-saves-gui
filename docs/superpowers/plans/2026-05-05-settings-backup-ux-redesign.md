# Plan 25: Settings → Backup UX redesign + banner / footer copy alignment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Replace `enabled / disabled / setup` vocabulary with verb-first `Save my own copy` + `Hide reminder`. Make Settings → Backup show progress in place. Eliminate dead-end "no backend" messages by linking the user straight to the Setup Guide modal.

**Architecture:** Extract a shared `<BackupRow domain="…" mode="library|settings">` component that owns the per-domain status line, Save/Stop button, and Hide-reminder toggle. A new pure helper `buildBackupStatusLine` builds the status string. `BackupStatusRow.svelte` becomes a thin parent that renders both rows in `library` mode (hidden when idle); Settings → Backup renders both rows in `settings` mode (always visible with launcher button). Banner CTAs are renamed `Hide reminder`. The article banner mounts its own setup modal so users can act on "no backend" messages without leaving the page. PostFocus footer wording matches Settings.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `4c21e67` (spec commit) or later.

---

## File structure

**Created:**
- `app/src/lib/backup-status-line.ts` — pure helper.
- `app/src/lib/backup-status-line.test.ts` — unit tests.
- `app/src/components/BackupRow.svelte` — shared row used by Library and Settings.

**Modified:**
- `app/src/lib/post-backup-status.ts` — gain a `link: 'library' | 'setup' | null` field; new wording.
- `app/src/lib/post-backup-status.test.ts` — assert the new `link` field.
- `app/src/components/BackupStatusRow.svelte` — becomes a thin wrapper over `<BackupRow domain="images" mode="library" />` + `<BackupRow domain="articles" mode="library" />`.
- `app/src/components/BackupBanner.svelte` — rename "Don't ask me again" → "Hide reminder".
- `app/src/components/ArticleBackupBanner.svelte` — rename CTA; add setup-modal mount + new no-backend sub-text.
- `app/src/reader/PostFocus.svelte` — render the new `link` from post-backup-status with appropriate trigger (navigate vs setup modal).
- `app/src/routes/Settings.svelte` — Backup section uses `<BackupRow mode="settings" />` for both domains; remove now-redundant per-domain logic.

---

## Task 1: `buildBackupStatusLine` helper + tests

**Files:**
- Create: `app/src/lib/backup-status-line.ts`
- Create: `app/src/lib/backup-status-line.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/backup-status-line.test.ts`:

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
    expect(r.link).toBeNull();
  });

  it('idle + no backend shows "Set up a backend" link', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: idle,
      backendDescription: null,
    });
    expect(r.text).toBe('Not yet saved · no backend available — Set up a backend');
    expect(r.link).toEqual({ kind: 'setup', phrase: 'Set up a backend' });
  });

  it('running shows "Saving X of N images…"', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'running', total: 47, fetched: 11, skipped: 1, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Saving 12 of 47 images…');
    expect(r.link).toBeNull();
  });

  it('done with no failures shows "X of N images saved"', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 5, fetched: 5, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('5 of 5 images saved');
  });

  it('done with failures shows the failed count', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: {
        status: 'done', total: 5, fetched: 3, skipped: 0, failed: 2,
        failures: [{ url: 'a', reason: 'x' }, { url: 'b', reason: 'y' }],
      },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('3 of 5 images saved (2 failed)');
  });

  it('cancelled shows "Stopped at X of N"', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: { status: 'cancelled', total: 10, fetched: 4, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Stopped at 4 of 10 articles');
  });

  it('uses singular noun when total === 1', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 1, fetched: 1, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('1 of 1 image saved');
  });

  it('article noun', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: { status: 'running', total: 3, fetched: 1, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Saving 1 of 3 articles…');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run app/src/lib/backup-status-line.test.ts
```

Expected: import resolution failure.

- [ ] **Step 3: Create `app/src/lib/backup-status-line.ts`**

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
  /** Trailing inline link descriptor when one is present. */
  readonly link: null | { kind: 'setup'; phrase: string };
}

function noun(domain: 'images' | 'articles', total: number): string {
  if (domain === 'images') return total === 1 ? 'image' : 'images';
  return total === 1 ? 'article' : 'articles';
}

export function buildBackupStatusLine(input: BackupStatusLineInput): BackupStatusLine {
  const { domain, hydration, backendDescription } = input;
  const succeeded = hydration.fetched + hydration.skipped;

  if (hydration.status === 'idle' || hydration.total === 0) {
    if (backendDescription === null) {
      return {
        text: 'Not yet saved · no backend available — Set up a backend',
        link: { kind: 'setup', phrase: 'Set up a backend' },
      };
    }
    return {
      text: `Not yet saved · would use ${backendDescription}`,
      link: null,
    };
  }

  if (hydration.status === 'running') {
    return {
      text: `Saving ${succeeded} of ${hydration.total} ${noun(domain, hydration.total)}…`,
      link: null,
    };
  }

  if (hydration.status === 'cancelled') {
    return {
      text: `Stopped at ${succeeded} of ${hydration.total} ${noun(domain, hydration.total)}`,
      link: null,
    };
  }

  // done
  if (hydration.failed > 0) {
    return {
      text: `${succeeded} of ${hydration.total} ${noun(domain, hydration.total)} saved (${hydration.failed} failed)`,
      link: null,
    };
  }
  return {
    text: `${succeeded} of ${hydration.total} ${noun(domain, hydration.total)} saved`,
    link: null,
  };
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/backup-status-line.test.ts
```

Expected: 0 errors, 0 warnings; 8/8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/backup-status-line.ts app/src/lib/backup-status-line.test.ts
git commit -m "feat(backup-status-line): pure builder for per-domain status copy"
```

DO NOT push.

---

## Task 2: `post-backup-status` gains a `link` field

**Files:**
- Modify: `app/src/lib/post-backup-status.ts`
- Modify: `app/src/lib/post-backup-status.test.ts`

The PostFocus footer needs to know whether to send the user to Library (a backend exists) or to the setup modal (no backend). Add a `setupAvailable` input and a `link` output.

- [ ] **Step 1: Update tests**

In `app/src/lib/post-backup-status.test.ts`, find the test cases that produce `"Not backed up yet."` summaries. Replace those tests' inputs and expected outputs to reflect the new wording and add link assertions.

Replace the test:

```ts
  it('returns "Not backed up yet." when nothing has been attempted', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: null,
      savedImageUrls: new Set(),
      imageHydration: idle,
      articleHydration: idle,
    });
    expect(r.summary).toBe('Not backed up yet.');
    expect(r.anyFailed).toBe(false);
  });
```

with two new tests:

```ts
  it('returns "Not yet saved — go to Library to save." when a backend is available', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: null,
      savedImageUrls: new Set(),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.summary).toBe('Not yet saved — go to Library to save.');
    expect(r.link).toBe('library');
    expect(r.anyFailed).toBe(false);
  });

  it('returns "Not yet saved — set up a backend." when no backend is available', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: null,
      savedImageUrls: new Set(),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: false,
    });
    expect(r.summary).toBe('Not yet saved — set up a backend.');
    expect(r.link).toBe('setup');
  });
```

For the other existing tests that didn't produce the `Not backed up yet.` summary (the saved/partial/article cases), add `setupAvailable: true` to each input object so they still type-check after the prop is added. Also assert `r.link === null` on the cases that don't produce a link.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run app/src/lib/post-backup-status.test.ts
```

Expected: failures because `setupAvailable` isn't part of the input shape and `link` isn't on the output.

- [ ] **Step 3: Update `app/src/lib/post-backup-status.ts`**

Add `setupAvailable: boolean` to `PostBackupStatusInput`. Add `link: 'library' | 'setup' | null` to `PostBackupStatus`. Update the summary builder so the all-pending case returns either the library or setup wording, and sets `link` appropriately. Other cases keep `link: null`.

Replace the relevant block in `getPostBackupStatus`:

```ts
  const summary = (() => {
    if (!hasAssets) return '';

    const imagesPending = images.total > 0 && images.saved === 0 && images.failed === 0;
    const articlePending = article !== null && article.state === 'pending';
    const allPending =
      (images.total === 0 || imagesPending) &&
      (article === null || articlePending);

    if (allPending && !hydrating) return 'Not backed up yet.';
    if (hydrating && (imagesPending || articlePending)) return 'Backing up…';
    // ...rest
  })();
```

with a version that consults `setupAvailable` for the `allPending && !hydrating` branch and assembles the `link` field:

```ts
  const imagesPending = images.total > 0 && images.saved === 0 && images.failed === 0;
  const articlePending = article !== null && article.state === 'pending';
  const allPending =
    (images.total === 0 || imagesPending) &&
    (article === null || articlePending);

  let summary = '';
  let link: 'library' | 'setup' | null = null;

  if (!hasAssets) {
    summary = '';
  } else if (allPending && !hydrating) {
    if (input.setupAvailable) {
      summary = 'Not yet saved — go to Library to save.';
      link = 'library';
    } else {
      summary = 'Not yet saved — set up a backend.';
      link = 'setup';
    }
  } else if (hydrating && (imagesPending || articlePending)) {
    summary = 'Backing up…';
  } else {
    const parts: string[] = [];
    if (images.total > 0) parts.push(imagesPart(images.total, images.saved, images.failed));
    if (article !== null) parts.push(articlePart(article));
    summary = parts.join(' · ') + '.';
    if (summary.length > 0) {
      summary = summary.charAt(0).toUpperCase() + summary.slice(1);
    }
  }
```

Update the returned object:

```ts
  return { hasAssets, images, article, hydrating, summary, anyFailed, link };
```

And declare `link` on the interface:

```ts
export interface PostBackupStatus {
  hasAssets: boolean;
  images: { total: number; saved: number; failed: number; failureReasons: string[] };
  article: null | { state: AssetState; reason?: string };
  hydrating: boolean;
  summary: string;
  anyFailed: boolean;
  link: 'library' | 'setup' | null;
}
```

And on the input:

```ts
export interface PostBackupStatusInput {
  save: Save;
  imageUrlsInPost: readonly string[];
  articleUrlInPost: string | null;
  savedImageUrls: ReadonlySet<string>;
  imageHydration: HydrationProgress;
  articleHydration: HydrationProgress;
  setupAvailable: boolean;
}
```

- [ ] **Step 4: Update `PostFocus.svelte` to pass `setupAvailable` and render the link**

In `app/src/reader/PostFocus.svelte`'s `<script>`, import `describeAvailableImageBackend` and `describeArticleBackend` from `$lib/describe-backend`. On mount (or reactively), compute `setupAvailable = (await describeAvailableImageBackend()) !== null || (await describeArticleBackend()).available`.

For now keep it simple: load both once on mount and re-compute when `$imageHydration` or `$articleHydration` changes (via the existing reactive trigger pattern):

```svelte
  import { describeAvailableImageBackend, describeArticleBackend } from '$lib/describe-backend';
  ...
  let setupAvailable = false;

  $: void (async () => {
    void $imageHydration.status;
    void $articleHydration.status;
    const img = await describeAvailableImageBackend();
    const art = await describeArticleBackend();
    setupAvailable = img !== null || art.available;
  })();
```

Pass `setupAvailable` into `getPostBackupStatus({...})`.

In the template, replace the existing static summary with a conditional that wraps the trailing phrase in an action when `status.link` is non-null. Today's footer:

```svelte
  {#if status.hasAssets}
    <footer
      class="post-focus__backup"
      class:post-focus__backup--failed={status.anyFailed}
      aria-label="Backup status"
    >
      {#if status.anyFailed}
        <button type="button" class="post-focus__backup-button" on:click={() => (failuresOpen = true)}>
          {status.summary}
        </button>
      {:else}
        {status.summary}
      {/if}
    </footer>
  {/if}
```

Replace the `{:else}` branch with one that splits the summary and treats the trailing phrase as a button when `status.link` is set:

```svelte
      {#if status.anyFailed}
        <button type="button" class="post-focus__backup-button" on:click={() => (failuresOpen = true)}>
          {status.summary}
        </button>
      {:else if status.link === 'library'}
        Not yet saved — <button type="button" class="post-focus__backup-button" on:click={() => navigate('/library')}>go to Library to save</button>.
      {:else if status.link === 'setup'}
        Not yet saved — <button type="button" class="post-focus__backup-button" on:click={() => (setupOpen = true)}>set up a backend</button>.
      {:else}
        {status.summary}
      {/if}
```

Add the imports + state at the top of the script:

```svelte
  import { navigate } from '$lib/router';
  import CustomProxySetupModal from '../components/CustomProxySetupModal.svelte';
  ...
  let setupOpen = false;
```

And mount the setup modal at the end of the article (just before `</article>`, alongside the existing `<BackupFailuresModal>`):

```svelte
  <CustomProxySetupModal
    open={setupOpen}
    on:close={() => (setupOpen = false)}
  />
```

- [ ] **Step 5: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/post-backup-status.ts app/src/lib/post-backup-status.test.ts app/src/reader/PostFocus.svelte
git commit -m "feat(post-backup-status): add link field for setup-vs-library footer routing"
```

DO NOT push.

---

## Task 3: `BackupRow.svelte` shared component

**Files:**
- Create: `app/src/components/BackupRow.svelte`

The component owns the per-domain UI: status line, Save/Stop button, Hide-reminder toggle. Two modes: `library` (hide when idle, no launcher/toggle) and `settings` (always visible, launcher + toggle).

- [ ] **Step 1: Create the component**

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

  $: store = domain === 'images' ? imageHydration : articleHydration;
  $: hydration = $store as HydrationProgress;
  $: status = hydration.status;

  $: dontAsk = backupPrefs
    ? domain === 'images'
      ? backupPrefs.images.dontAsk
      : backupPrefs.articles.dontAsk
    : false;

  $: line = buildBackupStatusLine({ domain, hydration, backendDescription });

  $: visible =
    mode === 'settings' || status !== 'idle';

  $: failedFailures = hydration.failures.map((f) => ({ ...f, type: domain === 'images' ? ('image' as const) : ('article' as const) }));

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
      } else {
        await reloadPrefs();
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

{#if visible}
  <div class="backup-row">
    <p class="backup-row__line">
      {#if line.link?.kind === 'setup'}
        {@const trailing = line.link.phrase}
        Not yet saved · no backend available — <button
          type="button"
          class="backup-row__inline-link"
          on:click={() => (setupOpen = true)}
        >{trailing}</button>
      {:else}
        {line.text}
      {/if}
      {#if status === 'done' && hydration.failed > 0}
        (<button
          type="button"
          class="backup-row__failed-link"
          on:click={() => (failuresOpen = true)}
        >{hydration.failed} failed</button>)
      {/if}
    </p>

    {#if mode === 'settings'}
      <div class="backup-row__actions">
        {#if status === 'running'}
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

<style>
  .backup-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem 0;
  }
  .backup-row__line {
    margin: 0;
    font-size: 0.9rem;
  }
  .backup-row__actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .backup-row__actions button {
    font: inherit;
    padding: 0.4rem 0.85rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .backup-row__actions button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .backup-row__hide {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.875rem;
    opacity: 0.85;
  }
  .backup-row__inline-link,
  .backup-row__failed-link {
    font: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .backup-row__failed-link {
    color: color-mix(in oklab, red 70%, CanvasText);
  }
  .backup-row__error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: color-mix(in oklab, red 70%, CanvasText);
  }
  .backup-row__dismiss {
    font: inherit;
    background: none;
    border: 0;
    padding: 0 0.25rem;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
    opacity: 0.85;
  }
</style>
```

- [ ] **Step 2: Run check + build**

```bash
pnpm check && pnpm build
```

Expected: 0 errors, 0 warnings; both bundles build (the new component is unused but compiles).

- [ ] **Step 3: Commit**

```bash
git add app/src/components/BackupRow.svelte
git commit -m "feat(BackupRow): shared per-domain backup row for Library + Settings"
```

DO NOT push.

---

## Task 4: `BackupStatusRow` becomes a thin wrapper

**Files:**
- Modify: `app/src/components/BackupStatusRow.svelte`

Replace the entire body of this file with two `<BackupRow>` mounts.

- [ ] **Step 1: Replace the file content**

Replace `app/src/components/BackupStatusRow.svelte` entirely with:

```svelte
<script lang="ts">
  import BackupRow from './BackupRow.svelte';

  export let inventory: unknown;
</script>

<BackupRow domain="images" {inventory} mode="library" />
<BackupRow domain="articles" {inventory} mode="library" />
```

(Library renders only when at least one row is non-idle, since each `<BackupRow>` self-hides in `library` mode when idle.)

- [ ] **Step 2: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/BackupStatusRow.svelte
git commit -m "refactor(BackupStatusRow): wrap BackupRow per domain"
```

DO NOT push.

---

## Task 5: `Settings.svelte` Backup section uses `<BackupRow mode="settings" />`

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Update imports + remove redundant logic**

In `app/src/routes/Settings.svelte`'s `<script>`:

1. Add the import:

```svelte
  import BackupRow from '../components/BackupRow.svelte';
```

2. Remove these imports that are no longer used directly by Settings (they're imported by BackupRow):

```svelte
  import { cancelImageBackup } from '$lib/start-image-backup';
  import { startArticleBackup, cancelArticleBackup } from '$lib/start-article-backup';
  import { describeAvailableImageBackend, describeArticleBackend } from '$lib/describe-backend';
  import { detectBackends, type Backend } from '$lib/image-fetcher';
```

3. Remove these state variables and reactive declarations:
   - `detectedBackends`, `availableImageBackendDesc`, `articleBackendStatus`
   - `imagesEnabled`, `imagesDontAsk`, `articlesEnabled`, `articlesDontAsk`
   - `backupSectionVisible`
   - `helperBackend`, `workerBackend`
   - `imagesBackendLabel`, `articlesBackendLabel`
   - `articleSetupError`

4. Remove these handlers:
   - `handleDisableImages`, `handleToggleDontAsk`
   - `handleSetUpArticles`, `handleDisableArticles`, `handleToggleArticlesDontAsk`

5. Update `onMount` to drop the now-unused calls:

```svelte
  onMount(async () => {
    backupPrefs = await loadBackupPrefs();
    await refreshCustomProxyStatus();
    void probeOperatorProxy();
  });
```

6. Update `handleSetupModalChange` to drop the now-unused `detectBackends` call:

```svelte
  async function handleSetupModalChange(): Promise<void> {
    await refreshCustomProxyStatus();
  }
```

7. Update `handleToggleOperatorProxyOptOut` to drop the unused recalculations:

```svelte
  async function handleToggleOperatorProxyOptOut(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    await setOperatorProxyOptOut(checked);
    await reloadBackupPrefs();
  }
```

8. Update `clearAll` to drop the unused recalculations of `detectedBackends` (the function used to also reset `availableImageBackendDesc` and `articleBackendStatus`, both removed):

Find:

```svelte
    backupPrefs = await loadBackupPrefs();
    detectedBackends = await detectBackends();
    customProxyConfigured = false;
    operatorProxyReachable = 'unknown';
```

Replace with:

```svelte
    backupPrefs = await loadBackupPrefs();
    customProxyConfigured = false;
    operatorProxyReachable = 'unknown';
```

- [ ] **Step 2: Replace the Backup section template**

Find the existing Backup section (the `{#if backupSectionVisible}<section class="settings-section"> … </section>{/if}` block). Replace it with:

```svelte
  {#if $inventoryState.status === 'ready'}
    <section class="settings-section">
      <h3>Backup</h3>
      <p class="help">
        Save your own copies of images and linked articles so they keep showing
        up even if Bluesky or the source site changes.
      </p>

      <BackupRow domain="images" inventory={$inventoryState.inventory} mode="settings" />
      <BackupRow domain="articles" inventory={$inventoryState.inventory} mode="settings" />

      <details
        class="advanced-toggle"
        bind:open={backupAdvancedOpen}
      >
        <summary>Advanced backup options</summary>

        <div class="card advanced">
          <p class="advanced-heading"><strong>Custom Cloudflare Worker proxy</strong></p>
          <p class="help">
            Used as a fallback when no local helper is running. The setup is
            one-time, takes about 10 minutes, and runs on Cloudflare's free tier.
          </p>

          <button type="button" class="setup-guide-trigger" on:click={() => (setupModalOpen = true)}>
            {customProxyConfigured ? 'Edit setup' : 'Setup guide'}
          </button>

          {#if operatorProxyConfigured}
            <p class="advanced-heading advanced-heading--spaced"><strong>Operator's image proxy</strong></p>
            <p class="help">
              <code>{config.operatorImageProxyUrl}</code>
              {#if operatorProxyReachable === 'ok'}
                <span class="status-ok">· reachable</span>
              {:else if operatorProxyReachable === 'fail'}
                <span class="status-fail">· unreachable</span>
              {/if}
            </p>
            <p class="help">
              When set up by the site operator, this proxy is used as a fallback
              for image backup when no local helper or custom Cloudflare Worker is
              configured. Image bytes flow through the operator's worker; the
              operator does not log URLs or content.
            </p>
            <label class="checkbox">
              <input
                type="checkbox"
                checked={operatorProxyOptOut}
                on:change={handleToggleOperatorProxyOptOut}
              />
              <span>Don't use the operator's proxy</span>
            </label>
          {/if}
        </div>
      </details>
    </section>
  {/if}
```

(The Advanced section content is preserved verbatim; only the per-domain rows above it changed.)

- [ ] **Step 3: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/Settings.svelte
git commit -m "refactor(Settings): Backup section uses BackupRow with verb-first vocab"
```

DO NOT push.

---

## Task 6: Banner CTAs rename + article-banner setup link

**Files:**
- Modify: `app/src/components/BackupBanner.svelte`
- Modify: `app/src/components/ArticleBackupBanner.svelte`

- [ ] **Step 1: Rename CTAs**

In both `BackupBanner.svelte` and `ArticleBackupBanner.svelte`, find:

```svelte
        Don't ask me again
```

and replace with:

```svelte
        Hide reminder
```

- [ ] **Step 2: Article banner — setup link when no backend**

In `app/src/components/ArticleBackupBanner.svelte`:

1. Add the import for the setup modal:

```svelte
  import CustomProxySetupModal from './CustomProxySetupModal.svelte';
```

2. Add state:

```svelte
  let setupOpen = false;
```

3. Replace the existing sub-text block:

```svelte
    <p class="article-banner__sub">
      {#if articleBackendStatus.available}
        Will use {articleBackendStatus.description}.
      {:else}
        Article backup needs the local bsky-saves helper — currently {articleBackendStatus.description}.
      {/if}
    </p>
```

with:

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

4. After the existing `</div>` that closes `.article-banner` (just before `<style>`), mount the modal:

```svelte
<CustomProxySetupModal
  open={setupOpen}
  on:close={() => (setupOpen = false)}
  on:change={async () => { articleBackendStatus = await describeArticleBackend(); }}
/>
```

5. Add the inline-link CSS in the `<style>` block:

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

- [ ] **Step 3: Image banner — setup link when no backend**

In `app/src/components/BackupBanner.svelte`, the existing sub-text reads:

```svelte
    <p class="backup-banner__sub">
      {#if backendDesc}
        Will use {backendDesc}.
      {:else}
        No backup method is available — set up the local helper or a custom Cloudflare Worker first (Settings → Backup → Advanced).
      {/if}
    </p>
```

1. Add the import + state:

```svelte
  import CustomProxySetupModal from './CustomProxySetupModal.svelte';
  ...
  let setupOpen = false;
```

2. Replace the sub-text block with:

```svelte
    <p class="backup-banner__sub">
      {#if backendDesc}
        Will use {backendDesc}.
      {:else}
        No backup method is available.
        <button
          type="button"
          class="backup-banner__inline-link"
          on:click={() => (setupOpen = true)}
        >Set up a backend</button>
      {/if}
    </p>
```

3. Mount the modal at the end of the file (before `<style>`):

```svelte
<CustomProxySetupModal
  open={setupOpen}
  on:close={() => (setupOpen = false)}
  on:change={async () => { backendDesc = await describeAvailableImageBackend(); }}
/>
```

4. Add the inline-link CSS:

```css
  .backup-banner__inline-link {
    font: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
```

- [ ] **Step 4: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/BackupBanner.svelte app/src/components/ArticleBackupBanner.svelte
git commit -m "feat(banners): Hide reminder; setup-modal link when no backend"
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

- `buildBackupStatusLine` covers idle/running/done/cancelled and singular/plural; pure.
- `post-backup-status` exposes a `link` field; PostFocus footer uses it to navigate or open the setup modal.
- `BackupRow` works in both `library` and `settings` modes; covers Save / Stop / Hide reminder / failures-modal trigger / setup-modal trigger.
- `BackupStatusRow` collapsed to a thin wrapper.
- Settings → Backup section: two symmetric rows; old per-domain handlers deleted.
- Banner CTAs renamed `Hide reminder`; both banners can open the setup modal in place when no backend.
- `pnpm check && pnpm test && pnpm build` clean.

## What's next

Plan 25 closes the Settings → Backup UX redesign. The Settings → Backup section is now consistent with the banners and PostFocus footer, all using verb-first vocabulary and providing direct paths to setup when something is missing.
