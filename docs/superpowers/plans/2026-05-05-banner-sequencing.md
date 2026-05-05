# Plan 20: image banner gates the article banner

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Hide the article-backup discovery banner while the image-backup discovery banner is visible, so the user makes one decision at a time on Library.

**Architecture:** A tiny shared writable store, `imageBannerVisible`, lives in `app/src/lib/backup-banner-state.ts`. `BackupBanner` mirrors its computed `visible` into the store and resets it on destroy. `ArticleBackupBanner` adds `!$imageBannerVisible` to its visibility expression.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `2cd4f97` (spec commit) or later.

---

## File structure

**Created:**
- `app/src/lib/backup-banner-state.ts` — exports `imageBannerVisible` writable store.
- `app/src/lib/backup-banner-state.test.ts` — unit test for the new store.

**Modified:**
- `app/src/components/BackupBanner.svelte` — reactive write to the store + onDestroy reset.
- `app/src/components/ArticleBackupBanner.svelte` — gate the existing `visible` on `!$imageBannerVisible`.

---

## Task 1: Shared `imageBannerVisible` store

**Files:**
- Create: `app/src/lib/backup-banner-state.ts`
- Create: `app/src/lib/backup-banner-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/backup-banner-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { imageBannerVisible } from './backup-banner-state';

describe('imageBannerVisible store', () => {
  it('defaults to false', () => {
    // Reset first so this test is order-independent.
    imageBannerVisible.set(false);
    expect(get(imageBannerVisible)).toBe(false);
  });

  it('round-trips set(true) / set(false)', () => {
    imageBannerVisible.set(true);
    expect(get(imageBannerVisible)).toBe(true);
    imageBannerVisible.set(false);
    expect(get(imageBannerVisible)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run app/src/lib/backup-banner-state.test.ts
```

Expected: import resolution failure — module does not exist.

- [ ] **Step 3: Create the store module**

Create `app/src/lib/backup-banner-state.ts`:

```ts
import { writable, type Writable } from 'svelte/store';

/**
 * Tracks whether the image-backup discovery banner is currently visible on
 * the Library route. Used by ArticleBackupBanner to suppress itself while
 * the image banner is showing, so the user makes one decision at a time.
 *
 * Only BackupBanner writes to this store; resetting on destroy ensures the
 * article banner doesn't stay gated forever if the image banner unmounts.
 */
export const imageBannerVisible: Writable<boolean> = writable(false);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm check && pnpm vitest run app/src/lib/backup-banner-state.test.ts
```

Expected: 0 errors, 0 warnings; 2/2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/backup-banner-state.ts app/src/lib/backup-banner-state.test.ts
git commit -m "feat(backup-banner-state): add imageBannerVisible store"
```

DO NOT push.

---

## Task 2: `BackupBanner` writes to the store

**Files:**
- Modify: `app/src/components/BackupBanner.svelte`

- [ ] **Step 1: Add the import**

In `app/src/components/BackupBanner.svelte`, in the `<script lang="ts">` block, add `onDestroy` to the existing `svelte` import (currently only `onMount`) and add the new store import. The top of the script should look like:

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { extractImageUrls } from '$lib/extract-image-urls';
  import {
    shouldShowBackupBanner,
    snoozeBackupPrompt,
    setBackupDontAsk,
  } from '$lib/backup-prefs';
  import { imageHydration } from '$lib/hydration-state';
  import { startImageBackup } from '$lib/start-image-backup';
  import { describeAvailableImageBackend } from '$lib/describe-backend';
  import { imageBannerVisible } from '$lib/backup-banner-state';
```

- [ ] **Step 2: Mirror `visible` into the store**

Locate the existing reactive declaration:

```svelte
  $: visible = prefsAllow && imageCount > 0 && status === 'idle';
```

Add the store write on the next line:

```svelte
  $: visible = prefsAllow && imageCount > 0 && status === 'idle';
  $: imageBannerVisible.set(visible);
```

- [ ] **Step 3: Reset the store on destroy**

After the `onMount(...)` block, add an `onDestroy` lifecycle hook:

```svelte
  onDestroy(() => {
    imageBannerVisible.set(false);
  });
```

- [ ] **Step 4: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/BackupBanner.svelte
git commit -m "feat(BackupBanner): mirror visibility into imageBannerVisible store"
```

DO NOT push.

---

## Task 3: `ArticleBackupBanner` gates on the store

**Files:**
- Modify: `app/src/components/ArticleBackupBanner.svelte`

- [ ] **Step 1: Add the import**

In `app/src/components/ArticleBackupBanner.svelte`, add the new store import alongside the existing `$lib` imports:

```svelte
  import { imageBannerVisible } from '$lib/backup-banner-state';
```

- [ ] **Step 2: Add the gate to the visibility expression**

Locate the existing reactive declaration:

```svelte
  $: visible = prefsAllow && articleCount > 0 && status === 'idle';
```

Replace it with:

```svelte
  $: visible = !$imageBannerVisible && prefsAllow && articleCount > 0 && status === 'idle';
```

- [ ] **Step 3: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/ArticleBackupBanner.svelte
git commit -m "feat(ArticleBackupBanner): gate visibility on imageBannerVisible"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run the full test matrix + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 2: Manual smoke test**

Start the dev server in the background:

```bash
pnpm dev &
```

Sign in, load an inventory that has both image-bearing posts and article-link posts. Confirm:

1. With the image banner eligible, only the image banner renders on Library — the article banner is hidden.
2. Click "Don't ask me again" on the image banner. The article banner should appear.
3. Reload, click "Save my own copy" on the image banner. The image banner disappears (hydration started). The article banner should appear immediately.
4. Navigate away from Library and back. The article banner should still gate correctly on the image banner's current visibility.

Stop the dev server.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Self-Review Checklist

- New store module exists, exports `imageBannerVisible: Writable<boolean>` with default `false`.
- Store unit test passes.
- `BackupBanner` imports the store, mirrors `visible` into it via `$: imageBannerVisible.set(visible)`, and resets to `false` in `onDestroy`.
- `ArticleBackupBanner` imports the store and includes `!$imageBannerVisible` as the first term of the visibility conjunction.
- No other files modified.
- Three commits in order: store + test → BackupBanner write → ArticleBackupBanner gate.
- `pnpm check && pnpm test && pnpm build` clean throughout.

## What's next

- **Plan 19**: Show Details modal for backup failures (per-failure list with permalinks + reasons).
- **Plan 21**: PostFocus per-post backup status footer.
