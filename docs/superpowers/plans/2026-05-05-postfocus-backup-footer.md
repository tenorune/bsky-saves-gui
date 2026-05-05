# Plan 21: PostFocus per-post backup status footer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Show a one-line backup status footer at the bottom of each focused post (PostFocus.svelte) summarizing whether the post's images and article were saved, failed, or are still pending.

**Architecture:** A pure helper `getPostBackupStatus` summarizes per-post state from the inventory and hydration stores. PostFocus subscribes to both hydration stores, queries the IDB image-blob index for the post's image URLs, feeds everything into the helper, and renders a subdued (or red) one-line footer.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest. No new dependencies.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `ef14af3` (spec commit) or later.

---

## File structure

**Created:**
- `app/src/lib/post-backup-status.ts` — pure summarizer + types.
- `app/src/lib/post-backup-status.test.ts` — unit tests.

**Modified:**
- `app/src/lib/image-store.ts` — add `getSavedImageUrls(urls)` helper.
- `app/src/reader/PostFocus.svelte` — render the footer between the bsky.app link and the thread section.

---

## Task 1: Pure summarizer + tests

**Files:**
- Create: `app/src/lib/post-backup-status.ts`
- Create: `app/src/lib/post-backup-status.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/post-backup-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getPostBackupStatus } from './post-backup-status';
import type { Save } from '../reader/inventory-shape';

const sampleAuthor = { did: 'd', handle: 'h.example' };
const sampleRecord = { text: 't', createdAt: '2026-05-05T00:00:00Z' };
const baseSave: Save = {
  uri: 'at://x/y/1',
  author: sampleAuthor,
  record: sampleRecord,
};

const idle = { status: 'idle' as const, total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] };
const running = { status: 'running' as const, total: 1, fetched: 0, skipped: 0, failed: 0, failures: [] };

describe('getPostBackupStatus', () => {
  it('hides itself when post has no images and no article', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: [],
      articleUrlInPost: null,
      savedImageUrls: new Set(),
      imageHydration: idle,
      articleHydration: idle,
    });
    expect(r.hasAssets).toBe(false);
  });

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

  it('returns "Article saved." for an article-only post that succeeded', () => {
    const r = getPostBackupStatus({
      save: { ...baseSave, article_text: 'hello' } as Save,
      imageUrlsInPost: [],
      articleUrlInPost: 'https://a/1',
      savedImageUrls: new Set(),
      imageHydration: idle,
      articleHydration: idle,
    });
    expect(r.summary).toBe('Article saved.');
    expect(r.article?.state).toBe('saved');
  });

  it('returns "1 of 1 image saved." (singular) for a single saved image', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1'],
      articleUrlInPost: null,
      savedImageUrls: new Set(['https://i/1']),
      imageHydration: idle,
      articleHydration: idle,
    });
    expect(r.summary).toBe('1 of 1 image saved.');
  });

  it('returns "3 of 3 images saved." for all-saved images', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: null,
      savedImageUrls: new Set(['https://i/1', 'https://i/2', 'https://i/3']),
      imageHydration: idle,
      articleHydration: idle,
    });
    expect(r.summary).toBe('3 of 3 images saved.');
    expect(r.anyFailed).toBe(false);
  });

  it('returns "2 of 3 images saved (1 failed)." with anyFailed=true', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: null,
      savedImageUrls: new Set(['https://i/1', 'https://i/2']),
      imageHydration: {
        status: 'done',
        total: 3,
        fetched: 2,
        skipped: 0,
        failed: 1,
        failures: [{ url: 'https://i/3', reason: 'timeout' }],
      },
      articleHydration: idle,
    });
    expect(r.summary).toBe('2 of 3 images saved (1 failed).');
    expect(r.anyFailed).toBe(true);
    expect(r.images.failureReasons).toEqual(['timeout']);
  });

  it('joins images and article with " · " when both are present and saved', () => {
    const r = getPostBackupStatus({
      save: { ...baseSave, article_text: 'x' } as Save,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: 'https://a/1',
      savedImageUrls: new Set(['https://i/1', 'https://i/2', 'https://i/3']),
      imageHydration: idle,
      articleHydration: idle,
    });
    expect(r.summary).toBe('3 of 3 images saved · article saved.');
  });

  it('mixed images + article failed → reports both', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: 'https://a/1',
      savedImageUrls: new Set(['https://i/1', 'https://i/2']),
      imageHydration: {
        status: 'done',
        total: 3,
        fetched: 2,
        skipped: 0,
        failed: 1,
        failures: [{ url: 'https://i/3', reason: 'rate-limited' }],
      },
      articleHydration: {
        status: 'done',
        total: 1,
        fetched: 0,
        skipped: 0,
        failed: 1,
        failures: [{ url: 'https://a/1', reason: 'paywalled' }],
      },
    });
    expect(r.summary).toBe('2 of 3 images saved (1 failed) · article failed.');
    expect(r.anyFailed).toBe(true);
    expect(r.article?.reason).toBe('paywalled');
  });

  it('returns "Backing up…" when a hydration store is running with pending assets', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2'],
      articleUrlInPost: null,
      savedImageUrls: new Set(['https://i/1']),
      imageHydration: running,
      articleHydration: idle,
    });
    expect(r.summary).toBe('Backing up…');
    expect(r.hydrating).toBe(true);
  });

  it('images saved · article still pending', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2'],
      articleUrlInPost: 'https://a/1',
      savedImageUrls: new Set(['https://i/1', 'https://i/2']),
      imageHydration: idle,
      articleHydration: idle,
    });
    expect(r.summary).toBe('2 of 2 images saved · article not backed up yet.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run app/src/lib/post-backup-status.test.ts
```

Expected: import resolution failure (module does not exist).

- [ ] **Step 3: Create `app/src/lib/post-backup-status.ts`**

```ts
import type { Save } from '../reader/inventory-shape';
import type { HydrationProgress } from './hydration-state';

export type AssetState = 'saved' | 'failed' | 'pending';

export interface PostBackupStatus {
  hasAssets: boolean;
  images: {
    total: number;
    saved: number;
    failed: number;
    failureReasons: string[];
  };
  article: null | { state: AssetState; reason?: string };
  hydrating: boolean;
  summary: string;
  anyFailed: boolean;
}

export interface PostBackupStatusInput {
  save: Save;
  imageUrlsInPost: readonly string[];
  articleUrlInPost: string | null;
  savedImageUrls: ReadonlySet<string>;
  imageHydration: HydrationProgress;
  articleHydration: HydrationProgress;
}

function findFailureReason(
  failures: HydrationProgress['failures'],
  url: string,
): string | undefined {
  for (const f of failures) {
    if (f.url === url) return f.reason;
  }
  return undefined;
}

function imagesPart(
  total: number,
  saved: number,
  failed: number,
): string {
  const noun = total === 1 ? 'image' : 'images';
  if (failed > 0) return `${saved} of ${total} ${noun} saved (${failed} failed)`;
  return `${saved} of ${total} ${noun} saved`;
}

function articlePart(article: { state: AssetState }): string {
  if (article.state === 'saved') return 'article saved';
  if (article.state === 'failed') return 'article failed';
  return 'article not backed up yet';
}

export function getPostBackupStatus(
  input: PostBackupStatusInput,
): PostBackupStatus {
  const {
    save,
    imageUrlsInPost,
    articleUrlInPost,
    savedImageUrls,
    imageHydration,
    articleHydration,
  } = input;

  const hasAssets = imageUrlsInPost.length > 0 || articleUrlInPost !== null;

  const images = (() => {
    const total = imageUrlsInPost.length;
    let saved = 0;
    const failureReasons: string[] = [];
    for (const url of imageUrlsInPost) {
      if (savedImageUrls.has(url)) {
        saved++;
        continue;
      }
      const reason = findFailureReason(imageHydration.failures, url);
      if (reason !== undefined) failureReasons.push(reason);
    }
    return { total, saved, failed: failureReasons.length, failureReasons };
  })();

  const article = (() => {
    if (articleUrlInPost === null) return null;
    const articleText = (save as Record<string, unknown>).article_text;
    if (typeof articleText === 'string' && articleText.length > 0) {
      return { state: 'saved' as AssetState };
    }
    const reason = findFailureReason(articleHydration.failures, articleUrlInPost);
    if (reason !== undefined) return { state: 'failed' as AssetState, reason };
    return { state: 'pending' as AssetState };
  })();

  const hydrating =
    imageHydration.status === 'running' || articleHydration.status === 'running';

  const anyFailed =
    images.failed > 0 || (article !== null && article.state === 'failed');

  const summary = (() => {
    if (!hasAssets) return '';

    const imagesPending = images.total > 0 && images.saved === 0 && images.failed === 0;
    const articlePending = article !== null && article.state === 'pending';
    const allPending =
      (images.total === 0 || imagesPending) &&
      (article === null || articlePending);

    if (allPending && !hydrating) return 'Not backed up yet.';
    if (hydrating && (imagesPending || articlePending)) return 'Backing up…';

    const parts: string[] = [];
    if (images.total > 0) {
      parts.push(imagesPart(images.total, images.saved, images.failed));
    }
    if (article !== null) {
      parts.push(articlePart(article));
    }
    return parts.join(' · ') + '.';
  })();

  return { hasAssets, images, article, hydrating, summary, anyFailed };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm check && pnpm vitest run app/src/lib/post-backup-status.test.ts
```

Expected: 0 errors, 0 warnings; 10/10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/post-backup-status.ts app/src/lib/post-backup-status.test.ts
git commit -m "feat(post-backup-status): pure summarizer for per-post backup state"
```

DO NOT push.

---

## Task 2: `getSavedImageUrls` helper in `image-store.ts`

**Files:**
- Modify: `app/src/lib/image-store.ts`

The existing module exposes `hasImageBlob(url)`. Add a batch helper that returns the saved subset of a URL list.

- [ ] **Step 1: Add the helper at the bottom of `image-store.ts`**

```ts
/**
 * Given a set of image URLs, return the subset that already have a blob in IDB.
 * Used by PostFocus to render per-post backup status.
 */
export async function getSavedImageUrls(
  urls: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all(
    urls.map(async (url) => {
      if (await hasImageBlob(url)) out.add(url);
    }),
  );
  return out;
}
```

- [ ] **Step 2: Run check + tests**

```bash
pnpm check && pnpm test
```

Expected: 0 errors, 0 warnings; all tests still pass (no test added — the function is exercised manually + via the PostFocus integration).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/image-store.ts
git commit -m "feat(image-store): add getSavedImageUrls batch helper"
```

DO NOT push.

---

## Task 3: PostFocus footer

**Files:**
- Modify: `app/src/reader/PostFocus.svelte`

- [ ] **Step 1: Replace the `<script>` block**

Open `app/src/reader/PostFocus.svelte`. Replace the existing `<script lang="ts">` … `</script>` block with:

```svelte
<script lang="ts">
  import type { Save } from './inventory-shape';
  import { formatAuthor, formatDateTime, formatHandle } from './format';
  import PostBody from './PostBody.svelte';
  import HydratedImage from '../components/HydratedImage.svelte';
  import { imageHydration, articleHydration } from '$lib/hydration-state';
  import { getSavedImageUrls } from '$lib/image-store';
  import { getPostBackupStatus } from '$lib/post-backup-status';

  export let save: Save;

  $: thread = save.thread ?? [];
  $: bskyUrl = (() => {
    const m = /\/([^/]+)$/.exec(save.uri);
    const rkey = m?.[1] ?? '';
    return `https://bsky.app/profile/${encodeURIComponent(save.author.handle)}/post/${encodeURIComponent(rkey)}`;
  })();

  // Image URLs in this post: walk save.images and save.embed.images for http(s) entries.
  function imageUrlsForSave(s: Save): string[] {
    const out = new Set<string>();
    const collect = (arr: unknown) => {
      if (!Array.isArray(arr)) return;
      for (const img of arr) {
        if (!img || typeof img !== 'object') continue;
        const url = (img as Record<string, unknown>).url;
        if (typeof url === 'string' && /^https?:\/\//.test(url)) out.add(url);
      }
    };
    collect((s as Record<string, unknown>).images);
    const embed = (s as Record<string, unknown>).embed;
    if (embed && typeof embed === 'object') {
      collect((embed as Record<string, unknown>).images);
    }
    return [...out];
  }

  // Article URL: save.embed.url if it looks like an article link.
  function articleUrlForSave(s: Save): string | null {
    const embed = (s as Record<string, unknown>).embed;
    if (!embed || typeof embed !== 'object') return null;
    const url = (embed as Record<string, unknown>).url;
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
  }

  $: imageUrls = imageUrlsForSave(save);
  $: articleUrl = articleUrlForSave(save);

  let savedImageUrls = new Set<string>();

  // Re-query IDB whenever image hydration progresses (or on mount via reactive run).
  $: void (async () => {
    // Reactive trigger: depend on imageUrls and the fetched count.
    void $imageHydration.fetched;
    savedImageUrls = await getSavedImageUrls(imageUrls);
  })();

  $: status = getPostBackupStatus({
    save,
    imageUrlsInPost: imageUrls,
    articleUrlInPost: articleUrl,
    savedImageUrls,
    imageHydration: $imageHydration,
    articleHydration: $articleHydration,
  });
</script>
```

- [ ] **Step 2: Insert the footer in the template**

Locate the existing block in the template:

```svelte
  <p class="post-focus__link">
    <a href={bskyUrl} target="_blank" rel="noopener noreferrer">View on bsky.app</a>
  </p>

  {#if thread.length > 0}
```

Insert the footer between them:

```svelte
  <p class="post-focus__link">
    <a href={bskyUrl} target="_blank" rel="noopener noreferrer">View on bsky.app</a>
  </p>

  {#if status.hasAssets}
    <footer
      class="post-focus__backup"
      class:post-focus__backup--failed={status.anyFailed}
      aria-label="Backup status"
    >
      {status.summary}
    </footer>
  {/if}

  {#if thread.length > 0}
```

- [ ] **Step 3: Add CSS**

In the existing `<style>` block, append:

```css
  .post-focus__backup {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    opacity: 0.7;
  }
  .post-focus__backup--failed {
    color: color-mix(in oklab, red 70%, CanvasText);
    opacity: 0.95;
  }
```

- [ ] **Step 4: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 5: Commit**

```bash
git add app/src/reader/PostFocus.svelte
git commit -m "feat(PostFocus): per-post backup status footer"
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

- `getPostBackupStatus` is pure (no I/O) and exposes `failureReasons` for Plan 19 to consume later.
- Helper covers all summary cases listed in the spec table.
- `getSavedImageUrls` is a thin wrapper over `hasImageBlob` — Promise.all'd for batched IDB lookups.
- PostFocus footer hides cleanly when `hasAssets === false`.
- Failure styling switches via `class:post-focus__backup--failed` driven by `anyFailed`.
- Three commits: helper + tests → `image-store` helper → PostFocus footer.
- `pnpm check && pnpm test && pnpm build` clean throughout.

## What's next

- **Plan 19**: Show Details modal for backup failures (per-failure list with permalinks + reasons). The summarizer's `failureReasons` array and the hydration stores' `failures` already have what that plan will need.
