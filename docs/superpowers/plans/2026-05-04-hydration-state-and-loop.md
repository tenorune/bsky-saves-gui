# Plan 4: Image URL extractor, hydration state store, and background hydrator loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Wire the engine that walks an inventory, fetches each image via the Plan 3 dispatcher, stores blobs in IndexedDB, and reports live progress through a Svelte store — all without a UI.

**Architecture:** Three small modules:
1. `extract-image-urls.ts` — pure function that walks an inventory tree (top-level, quoted_post, thread_replies, and quoted_post.thread_replies) and returns a deduped list of `https?://` image URLs.
2. `hydration-state.ts` — singleton Svelte writable for image-hydration progress, plus a reset helper.
3. `image-hydrator.ts` — async loop that drives `fetchImage(url)`, writes blobs to `image-store`, updates the state store as it goes, and respects an AbortSignal for clean cancellation.

These modules are non-UI. Plan 5+ wires them into Library banner, status row, PostFocus footer, etc.

**Tech Stack:** Same as previous plans.

**Spec references:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` — sections "Background hydration", "Library page changes" (for the state shape), and "Cancellation and disable".

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `fb096a3` (Plan 3 final commit) or later.

---

## Task 1: Image URL extractor

A pure function — no side effects, no I/O — that walks an inventory and returns the distinct list of `https?://` image URLs.

It must visit four locations per save (matching `bsky_saves.images._iter_image_urls` in the Python package):

1. `save.images[i].url`
2. `save.quoted_post.images[i].url`
3. `save.thread_replies[i].images[j].url`
4. `save.quoted_post.thread_replies[i].images[j].url`

Order doesn't matter (callers will sort or process arbitrarily). Dedup is required (Set semantics). Non-http URLs (e.g. `data:`) are filtered out.

**Files:**
- Create: `app/src/lib/extract-image-urls.ts`
- Create: `app/src/lib/extract-image-urls.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/extract-image-urls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('extractImageUrls', () => {
  it('returns [] for non-object inputs', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    expect(extractImageUrls(null)).toEqual([]);
    expect(extractImageUrls(undefined)).toEqual([]);
    expect(extractImageUrls('string')).toEqual([]);
    expect(extractImageUrls(42)).toEqual([]);
  });

  it('returns [] when saves is missing or not an array', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    expect(extractImageUrls({})).toEqual([]);
    expect(extractImageUrls({ saves: 'oops' })).toEqual([]);
    expect(extractImageUrls({ saves: [] })).toEqual([]);
  });

  it('collects URLs from top-level images', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        { images: [{ url: 'https://x/a.jpg' }, { url: 'https://x/b.jpg' }] },
      ],
    });
    expect(urls.sort()).toEqual(['https://x/a.jpg', 'https://x/b.jpg']);
  });

  it('collects URLs from quoted_post.images', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [{ quoted_post: { images: [{ url: 'https://x/q.jpg' }] } }],
    });
    expect(urls).toEqual(['https://x/q.jpg']);
  });

  it('collects URLs from thread_replies[i].images', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        {
          thread_replies: [
            { images: [{ url: 'https://x/t1.jpg' }] },
            { images: [{ url: 'https://x/t2.jpg' }] },
          ],
        },
      ],
    });
    expect(urls.sort()).toEqual(['https://x/t1.jpg', 'https://x/t2.jpg']);
  });

  it('collects URLs from quoted_post.thread_replies[i].images', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        {
          quoted_post: {
            thread_replies: [{ images: [{ url: 'https://x/qt.jpg' }] }],
          },
        },
      ],
    });
    expect(urls).toEqual(['https://x/qt.jpg']);
  });

  it('dedupes URLs that appear in multiple locations', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        {
          images: [{ url: 'https://x/dup.jpg' }],
          thread_replies: [{ images: [{ url: 'https://x/dup.jpg' }] }],
        },
      ],
    });
    expect(urls).toEqual(['https://x/dup.jpg']);
  });

  it('filters out non-http URLs', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [{ images: [{ url: 'data:image/png;base64,abc' }, { url: 'ftp://x/y' }] }],
    });
    expect(urls).toEqual([]);
  });

  it('ignores image entries without a string url', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [{ images: [{ alt: 'no url' }, null, 42, { url: 123 }] }],
    });
    expect(urls).toEqual([]);
  });

  it('handles a realistic inventory with all four locations populated', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        {
          uri: 'a',
          images: [{ url: 'https://x/1' }],
          quoted_post: {
            images: [{ url: 'https://x/2' }],
            thread_replies: [{ images: [{ url: 'https://x/3' }] }],
          },
          thread_replies: [{ images: [{ url: 'https://x/4' }] }],
        },
        { uri: 'b', images: [{ url: 'https://x/5' }] },
      ],
    });
    expect(urls.sort()).toEqual([
      'https://x/1',
      'https://x/2',
      'https://x/3',
      'https://x/4',
      'https://x/5',
    ]);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test extract-image-urls`

- [ ] **Step 3: Implement the module**

Create `app/src/lib/extract-image-urls.ts`:

```ts
// Walks an inventory and returns the distinct list of https?:// image URLs.
// Pure function: no side effects, no I/O. Mirrors bsky_saves.images._iter_image_urls
// in the Python package — visits four locations per save:
//
//   1. save.images[i].url
//   2. save.quoted_post.images[i].url
//   3. save.thread_replies[i].images[j].url
//   4. save.quoted_post.thread_replies[i].images[j].url
//
// Dedupes via Set. Non-http URLs (data:, ftp:, etc.) are filtered out.

const HTTP_RE = /^https?:\/\//;

function collectFromImageArray(arr: unknown, out: Set<string>): void {
  if (!Array.isArray(arr)) return;
  for (const img of arr) {
    if (!img || typeof img !== 'object') continue;
    const url = (img as Record<string, unknown>).url;
    if (typeof url === 'string' && HTTP_RE.test(url)) out.add(url);
  }
}

function collectFromRepliesArray(arr: unknown, out: Set<string>): void {
  if (!Array.isArray(arr)) return;
  for (const reply of arr) {
    if (!reply || typeof reply !== 'object') continue;
    collectFromImageArray((reply as Record<string, unknown>).images, out);
  }
}

function collectFromSave(entry: unknown, out: Set<string>): void {
  if (!entry || typeof entry !== 'object') return;
  const e = entry as Record<string, unknown>;
  collectFromImageArray(e.images, out);
  collectFromRepliesArray(e.thread_replies, out);

  const quoted = e.quoted_post;
  if (quoted && typeof quoted === 'object') {
    const q = quoted as Record<string, unknown>;
    collectFromImageArray(q.images, out);
    collectFromRepliesArray(q.thread_replies, out);
  }
}

export function extractImageUrls(inventory: unknown): string[] {
  if (!inventory || typeof inventory !== 'object') return [];
  const inv = inventory as { saves?: unknown };
  if (!Array.isArray(inv.saves)) return [];
  const out = new Set<string>();
  for (const save of inv.saves) collectFromSave(save, out);
  return [...out];
}
```

- [ ] **Step 4: Run tests — confirm all 10 pass**

Run: `pnpm test extract-image-urls`

Expected: 10/10 passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 97 → 107.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(extract-image-urls): walk inventory tree, return deduped image URLs"
```

DO NOT push.

---

## Task 2: Hydration state store

A singleton Svelte writable that captures progress for the image hydration loop. The store's shape matches the design spec exactly. A reset function returns it to the initial state.

**Files:**
- Create: `app/src/lib/hydration-state.ts`
- Create: `app/src/lib/hydration-state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/hydration-state.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';

beforeEach(async () => {
  const { resetImageHydration } = await import('./hydration-state');
  resetImageHydration();
});

describe('hydration-state', () => {
  it('starts in the idle state with zero counters and empty failures', async () => {
    const { imageHydration } = await import('./hydration-state');
    expect(get(imageHydration)).toEqual({
      status: 'idle',
      total: 0,
      fetched: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  });

  it('resetImageHydration restores the initial state after mutation', async () => {
    const { imageHydration, resetImageHydration } = await import('./hydration-state');
    imageHydration.set({
      status: 'running',
      total: 5,
      fetched: 2,
      skipped: 1,
      failed: 1,
      failures: [{ url: 'https://x/oops', reason: 'HTTP 502' }],
    });
    expect(get(imageHydration).status).toBe('running');
    resetImageHydration();
    expect(get(imageHydration)).toEqual({
      status: 'idle',
      total: 0,
      fetched: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  });

  it('exposes the HydrationProgress type with all status variants', async () => {
    const { imageHydration } = await import('./hydration-state');
    // Type-level check via runtime: each status string is valid.
    const statuses = ['idle', 'running', 'paused', 'done', 'cancelled'] as const;
    for (const status of statuses) {
      imageHydration.update((s) => ({ ...s, status }));
      expect(get(imageHydration).status).toBe(status);
    }
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `pnpm test hydration-state`

- [ ] **Step 3: Implement the module**

Create `app/src/lib/hydration-state.ts`:

```ts
// Singleton Svelte store for image-hydration progress. Subscribed to by
// the Library status row, the PostFocus backup footer, and the Show Details
// modal. Updated by image-hydrator's background loop.
//
// A second store (articleHydration) will be added in a later plan when
// article backup lands; the shape is identical.

import { writable, type Writable } from 'svelte/store';

export type HydrationStatus = 'idle' | 'running' | 'paused' | 'done' | 'cancelled';

export interface HydrationFailure {
  readonly url: string;
  readonly reason: string;
}

export interface HydrationProgress {
  readonly status: HydrationStatus;
  readonly total: number;
  readonly fetched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly failures: readonly HydrationFailure[];
}

const INITIAL: HydrationProgress = {
  status: 'idle',
  total: 0,
  fetched: 0,
  skipped: 0,
  failed: 0,
  failures: [],
};

export const imageHydration: Writable<HydrationProgress> = writable(INITIAL);

export function resetImageHydration(): void {
  imageHydration.set(INITIAL);
}
```

- [ ] **Step 4: Run tests — confirm all 3 pass**

Run: `pnpm test hydration-state`

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 107 → 110.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(hydration-state): Svelte store for image-hydration progress"
```

DO NOT push.

---

## Task 3: Background image hydrator

The async loop that drives the whole thing. Walks the inventory, calls `fetchImage(url)` per URL (skipping ones already in `image-store`), saves successful blobs back to the store, updates `imageHydration` as it goes, and respects an `AbortSignal` for clean cancellation.

`fetchImage` is injected via options for testability; default is the real one from Plan 3.

**Files:**
- Create: `app/src/lib/image-hydrator.ts`
- Create: `app/src/lib/image-hydrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/image-hydrator.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
  const { resetImageHydration } = await import('./hydration-state');
  resetImageHydration();
});

const inv = {
  saves: [
    {
      uri: 'a',
      images: [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }],
    },
    {
      uri: 'b',
      thread_replies: [{ images: [{ url: 'https://x/3.jpg' }] }],
    },
  ],
};

const okBlob = (n: number) => new Blob([`IMG${n}`], { type: 'image/png' });

describe('hydrateImages happy path', () => {
  it('fetches every URL, writes to image-store, and reports done', async () => {
    const fetcher = vi.fn(async (url: string) => okBlob(url.length));
    const { hydrateImages } = await import('./image-hydrator');
    const { imageHydration } = await import('./hydration-state');
    const result = await hydrateImages(inv, { fetcher });
    expect(result).toEqual({ fetched: 3, skipped: 0, failed: 0, cancelled: false });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(get(imageHydration)).toMatchObject({
      status: 'done',
      total: 3,
      fetched: 3,
      skipped: 0,
      failed: 0,
    });

    const { hasImageBlob } = await import('./image-store');
    expect(await hasImageBlob('https://x/1.jpg')).toBe(true);
    expect(await hasImageBlob('https://x/2.jpg')).toBe(true);
    expect(await hasImageBlob('https://x/3.jpg')).toBe(true);
  });
});

describe('hydrateImages skips already-cached URLs', () => {
  it('does not call the fetcher for URLs whose blob is already stored', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://x/1.jpg', okBlob(1));
    await saveImageBlob('https://x/2.jpg', okBlob(2));
    const fetcher = vi.fn(async () => okBlob(99));
    const { hydrateImages } = await import('./image-hydrator');
    const result = await hydrateImages(inv, { fetcher });
    expect(result).toEqual({ fetched: 1, skipped: 2, failed: 0, cancelled: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://x/3.jpg');
  });
});

describe('hydrateImages records failures without aborting the run', () => {
  it('continues past failed URLs and exposes the reasons', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://x/2.jpg') throw new Error('upstream 404');
      return okBlob(1);
    });
    const { hydrateImages } = await import('./image-hydrator');
    const { imageHydration } = await import('./hydration-state');
    const result = await hydrateImages(inv, { fetcher });
    expect(result).toEqual({ fetched: 2, skipped: 0, failed: 1, cancelled: false });
    const state = get(imageHydration);
    expect(state.status).toBe('done');
    expect(state.failures).toEqual([
      { url: 'https://x/2.jpg', reason: 'upstream 404' },
    ]);
  });
});

describe('hydrateImages handles an empty URL list', () => {
  it('returns done immediately with zero counters', async () => {
    const fetcher = vi.fn(async () => okBlob(1));
    const { hydrateImages } = await import('./image-hydrator');
    const { imageHydration } = await import('./hydration-state');
    const result = await hydrateImages({ saves: [] }, { fetcher });
    expect(result).toEqual({ fetched: 0, skipped: 0, failed: 0, cancelled: false });
    expect(get(imageHydration).status).toBe('done');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('hydrateImages respects AbortSignal cancellation', () => {
  it('stops between iterations when the signal aborts and reports cancelled', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetcher = vi.fn(async (_url: string) => {
      calls++;
      if (calls === 1) controller.abort(); // abort right after first fetch
      return okBlob(1);
    });
    const { hydrateImages } = await import('./image-hydrator');
    const { imageHydration } = await import('./hydration-state');
    const result = await hydrateImages(inv, { fetcher, signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.fetched).toBeLessThan(3);
    expect(get(imageHydration).status).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test image-hydrator`

- [ ] **Step 3: Implement the module**

Create `app/src/lib/image-hydrator.ts`:

```ts
// Background loop that walks an inventory's image URLs, fetches each via the
// Plan 3 dispatcher, writes successful blobs to image-store, and reports
// progress through the hydration-state store.
//
// Designed for foreground-friendly background execution: each await on the
// fetcher yields control to the event loop, so the rest of the app stays
// responsive while hydration runs. AbortSignal allows clean cancellation
// between iterations; in-flight fetches finish but the loop exits afterwards.

import { extractImageUrls } from './extract-image-urls';
import { hasImageBlob, saveImageBlob } from './image-store';
import { fetchImage as defaultFetchImage } from './image-fetcher';
import { imageHydration, type HydrationFailure, type HydrationProgress } from './hydration-state';

export interface HydrateResult {
  readonly fetched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

export interface HydrateOptions {
  /** Inject a fetcher for testing. Defaults to the real layered dispatcher. */
  readonly fetcher?: (url: string) => Promise<Blob>;
  /** Cancel the loop cleanly between iterations. */
  readonly signal?: AbortSignal;
}

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function hydrateImages(
  inventory: unknown,
  options: HydrateOptions = {},
): Promise<HydrateResult> {
  const fetcher = options.fetcher ?? defaultFetchImage;
  const signal = options.signal;

  const urls = extractImageUrls(inventory);

  imageHydration.set({
    status: urls.length === 0 ? 'done' : 'running',
    total: urls.length,
    fetched: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  });

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  const failures: HydrationFailure[] = [];

  for (const url of urls) {
    if (signal?.aborted) {
      imageHydration.update((s) => ({ ...s, status: 'cancelled' }));
      return { fetched, skipped, failed, cancelled: true };
    }

    if (await hasImageBlob(url)) {
      skipped++;
      imageHydration.update((s) => ({ ...s, skipped: s.skipped + 1 }));
      continue;
    }

    try {
      const blob = await fetcher(url);
      await saveImageBlob(url, blob);
      fetched++;
      imageHydration.update((s) => ({ ...s, fetched: s.fetched + 1 }));
    } catch (err) {
      const failure: HydrationFailure = { url, reason: reasonOf(err) };
      failures.push(failure);
      failed++;
      imageHydration.update<HydrationProgress>((s) => ({
        ...s,
        failed: s.failed + 1,
        failures: [...s.failures, failure],
      }));
    }
  }

  imageHydration.update((s) => ({ ...s, status: 'done' }));
  return { fetched, skipped, failed, cancelled: false };
}
```

- [ ] **Step 4: Run tests — confirm all 5 pass**

Run: `pnpm test image-hydrator`

Expected: 5/5 passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 110 → 115.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(image-hydrator): background loop with progress + cancellation"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors (3 pre-existing CSS warnings tolerated). All ~115 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

After Plan 4, all the moving parts for image backup exist as standalone modules: blob storage (Plan 2), preferences (Plan 2), helper detection (Plan 2), backend dispatchers (Plan 3), URL extraction (Plan 4), state store (Plan 4), and the hydration loop (Plan 4). Plan 5 starts wiring them into the GUI:

- **Plan 5** — `HydratedImage` component (swaps remote URL for blob URL when cached) and the Library `BackupStatusRow` (subscribed to `imageHydration`).
- **Plan 6** — Setup wizard modal + image-backup banner + Settings Backup section.
- **Plan 7** — PostFocus backup footer + Show Details modal.
- **Plan 8** — Article backup (extends Plans 3-7 patterns).
- **Plan 9** — Polish: privacy doc rewrite, operator-proxy backend, helper version compatibility warnings.
