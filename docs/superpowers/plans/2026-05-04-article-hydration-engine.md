# Plan 9: Article hydration engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Build the engine for article backup. After this plan, `startArticleBackup(inventory)` walks the inventory's article URLs, calls the helper's `POST /extract-article` for each, mutates the inventory in place to add `article_text` (and `article_title` when known), persists the updated inventory back to IndexedDB, and reports progress through a new Svelte store. **No UI yet** — Plan 10 wires this into a banner, status row, and Settings row.

**Architecture** mirrors the image stack, with a few honest differences:

- **Storage:** articles live INSIDE the inventory (each save's `article_text` field), not in a separate IDB store. This matches the bsky-saves CLI shape and the existing parser, which already synthesizes `save.article` from `article_text`. The hydrator mutates the inventory and saves it back via `saveInventory()` + `loadFromDb()` so the Library re-renders.
- **Backend:** **helper only** for now. The user-deployed cf-worker doesn't currently run trafilatura, and Pyodide can't import it cleanly. Article extraction needs a server-side process. Plan 11+ may extend the cf-worker template with an extraction endpoint.
- **URL location:** `save.embed.url` (top-level external link). Quoted-post articles are out of scope for Plan 9 — rare and easy to add later.

**Scope (5 tasks):**

1. `extract-article-urls.ts` — pure function returning distinct article URLs.
2. Extend `helper-client.ts` with `extractArticleViaHelper(origin, url)`.
3. Extend `hydration-state.ts` with `articleHydration` store.
4. `article-hydrator.ts` — async loop, mutates inventory + persists.
5. `start-article-backup.ts` — run lifecycle helper (probes helper, returns `{started, reason?}`, owns AbortController).

**Out of scope (Plan 10+):**
- Article-backup banner.
- Article row in Library `BackupStatusRow`.
- Article row in Settings → Backup.
- PostFocus article-backup footer.
- Article extraction via cf-worker (extension to template).
- Quoted-post article URLs.
- Re-running hydration to refresh stale articles.

**Tech Stack:** Same as previous plans. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` "Image-vs-article wrinkles" — articles need extraction (trafilatura), not just bytes; only helper supports them in v1.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `2d83a2c` (Plan 8 final commit) or later.

---

## Task 1: `extract-article-urls.ts` — pure URL extractor

Walks an inventory and returns the deduped list of `https?://` article URLs from each save's `embed.url`.

**Files:**
- Create: `app/src/lib/extract-article-urls.ts`
- Create: `app/src/lib/extract-article-urls.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/extract-article-urls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('extractArticleUrls', () => {
  it('returns [] for non-object inputs', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    expect(extractArticleUrls(null)).toEqual([]);
    expect(extractArticleUrls(undefined)).toEqual([]);
    expect(extractArticleUrls('string')).toEqual([]);
  });

  it('returns [] when saves is missing or not an array', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    expect(extractArticleUrls({})).toEqual([]);
    expect(extractArticleUrls({ saves: 'oops' })).toEqual([]);
    expect(extractArticleUrls({ saves: [] })).toEqual([]);
  });

  it('collects URLs from save.embed.url', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [
        { embed: { url: 'https://example.com/a' } },
        { embed: { url: 'https://example.com/b' } },
      ],
    });
    expect(urls.sort()).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('skips saves whose article is already hydrated (article_text present)', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [
        { embed: { url: 'https://example.com/a' }, article_text: 'already done' },
        { embed: { url: 'https://example.com/b' } },
      ],
    });
    expect(urls).toEqual(['https://example.com/b']);
  });

  it('dedupes URLs that appear in multiple saves', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [
        { embed: { url: 'https://example.com/x' } },
        { embed: { url: 'https://example.com/x' } },
      ],
    });
    expect(urls).toEqual(['https://example.com/x']);
  });

  it('filters out non-http URLs', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [{ embed: { url: 'data:text/plain,foo' } }, { embed: { url: 'mailto:a@b' } }],
    });
    expect(urls).toEqual([]);
  });

  it('ignores saves without an embed object', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [
        { uri: 'a' }, // no embed
        { embed: null },
        { embed: 'oops' },
        { embed: { url: 'https://x/ok' } },
      ],
    });
    expect(urls).toEqual(['https://x/ok']);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `pnpm test extract-article-urls`

- [ ] **Step 3: Implement the module**

Create `app/src/lib/extract-article-urls.ts`:

```ts
// Walks an inventory and returns the distinct list of https?:// article URLs
// referenced from each save's `embed.url`. Pure function.
//
// Skips saves whose `article_text` is already populated — those have been
// hydrated and don't need re-fetching.
//
// Quoted-post articles are NOT walked here; they're rare and easy to add in
// a follow-up plan.

const HTTP_RE = /^https?:\/\//;

export function extractArticleUrls(inventory: unknown): string[] {
  if (!inventory || typeof inventory !== 'object') return [];
  const inv = inventory as { saves?: unknown };
  if (!Array.isArray(inv.saves)) return [];
  const out = new Set<string>();
  for (const save of inv.saves) {
    if (!save || typeof save !== 'object') continue;
    const s = save as Record<string, unknown>;
    if (typeof s.article_text === 'string') continue; // already hydrated
    const embed = s.embed;
    if (!embed || typeof embed !== 'object') continue;
    const url = (embed as Record<string, unknown>).url;
    if (typeof url === 'string' && HTTP_RE.test(url)) out.add(url);
  }
  return [...out];
}
```

- [ ] **Step 4: Run tests — confirm all 7 pass**

Run: `pnpm test extract-article-urls`

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 127 → 134.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(extract-article-urls): walk inventory, return deduped article URLs"
```

DO NOT push.

---

## Task 2: `extractArticleViaHelper` in helper-client

Add an article-extraction call to the existing helper-client. Per the bsky-saves serve spec, `POST /extract-article` accepts `{url}` and returns `{url, title, text, fetched_at}` JSON.

**Files:**
- Modify: `app/src/lib/helper-client.ts`
- Modify: `app/src/lib/helper-client.test.ts`

- [ ] **Step 1: Append tests**

Append the following `describe` block to the END of `app/src/lib/helper-client.test.ts`:

```ts
describe('helper-client extractArticleViaHelper', () => {
  it('POSTs the URL as JSON and returns the parsed envelope', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        url: 'https://example.com/post',
        title: 'A great post',
        text: 'Body of the article.',
        fetched_at: '2026-05-04T12:00:00Z',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { extractArticleViaHelper } = await import('./helper-client');
    const result = await extractArticleViaHelper(
      'http://127.0.0.1:47826',
      'https://example.com/post',
    );
    expect(result).toEqual({
      url: 'https://example.com/post',
      title: 'A great post',
      text: 'Body of the article.',
      fetched_at: '2026-05-04T12:00:00Z',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/extract-article',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: 'https://example.com/post' }),
      }),
    );
  });

  it('returns {note} when the helper indicates no extractable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          url: 'https://example.com/paywall',
          title: '',
          text: '',
          fetched_at: '2026-05-04T12:00:00Z',
          note: 'no extractable body',
        }),
      })),
    );
    const { extractArticleViaHelper } = await import('./helper-client');
    const result = await extractArticleViaHelper(
      'http://127.0.0.1:47826',
      'https://example.com/paywall',
    );
    expect(result.note).toBe('no extractable body');
    expect(result.text).toBe('');
  });

  it('throws on non-2xx with status in the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) })),
    );
    const { extractArticleViaHelper } = await import('./helper-client');
    await expect(
      extractArticleViaHelper('http://127.0.0.1:47826', 'https://example.com/x'),
    ).rejects.toThrow(/502/);
  });

  it('throws on malformed envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ unexpected: true }) })),
    );
    const { extractArticleViaHelper } = await import('./helper-client');
    await expect(
      extractArticleViaHelper('http://127.0.0.1:47826', 'https://example.com/x'),
    ).rejects.toThrow(/malformed/i);
  });

  it('throws on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { extractArticleViaHelper } = await import('./helper-client');
    await expect(
      extractArticleViaHelper('http://127.0.0.1:47826', 'https://example.com/x'),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `pnpm test helper-client`

Expected: existing tests pass; 5 new ones fail with module-not-found-export style errors.

- [ ] **Step 3: Implement `extractArticleViaHelper`**

Add to `app/src/lib/helper-client.ts` (below `fetchImageViaHelper`):

```ts
export interface ExtractedArticle {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly fetched_at: string;
  readonly note?: string;
}

function isExtractedArticle(v: unknown): v is ExtractedArticle {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.url === 'string' &&
    typeof r.title === 'string' &&
    typeof r.text === 'string' &&
    typeof r.fetched_at === 'string' &&
    (r.note === undefined || typeof r.note === 'string')
  );
}

/**
 * Extract an article via the local helper's POST /extract-article endpoint.
 * Returns title + text + metadata. Throws on non-2xx, malformed envelope, or
 * network failure.
 */
export async function extractArticleViaHelper(
  origin: string,
  articleUrl: string,
): Promise<ExtractedArticle> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/extract-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: articleUrl }),
  });
  if (!res.ok) {
    throw new Error(`helper /extract-article returned ${res.status}`);
  }
  const body = (await res.json()) as unknown;
  if (!isExtractedArticle(body)) {
    throw new Error('helper /extract-article returned malformed JSON');
  }
  return body;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test helper-client`

Expected: 13/13 passing (was 8; +5 new).

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 134 → 139.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(helper-client): extractArticleViaHelper (POST /extract-article)"
```

DO NOT push.

---

## Task 3: `articleHydration` store in hydration-state

Mirror `imageHydration` for articles. Same `HydrationProgress` shape. Adds a `resetArticleHydration()` reset helper.

**Files:**
- Modify: `app/src/lib/hydration-state.ts`
- Modify: `app/src/lib/hydration-state.test.ts`

- [ ] **Step 1: Add tests**

Append the following inside the existing `describe('hydration-state', ...)` block in `app/src/lib/hydration-state.test.ts`, BEFORE its closing `});`:

```ts
  it('articleHydration starts in the same idle state', async () => {
    const { articleHydration } = await import('./hydration-state');
    expect(get(articleHydration)).toEqual({
      status: 'idle',
      total: 0,
      fetched: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  });

  it('resetArticleHydration restores the initial state', async () => {
    const { articleHydration, resetArticleHydration } = await import('./hydration-state');
    articleHydration.set({
      status: 'running',
      total: 3,
      fetched: 1,
      skipped: 0,
      failed: 1,
      failures: [{ url: 'https://x', reason: 'paywall' }],
    });
    resetArticleHydration();
    expect(get(articleHydration).status).toBe('idle');
    expect(get(articleHydration).total).toBe(0);
  });

  it('image and article stores are independent', async () => {
    const { imageHydration, articleHydration } = await import('./hydration-state');
    imageHydration.set({
      status: 'running',
      total: 5,
      fetched: 2,
      skipped: 0,
      failed: 0,
      failures: [],
    });
    expect(get(articleHydration).status).toBe('idle');
    expect(get(imageHydration).status).toBe('running');
  });
```

Also extend the existing `beforeEach` block at the top to also reset article state:

```ts
beforeEach(async () => {
  const { resetImageHydration, resetArticleHydration } = await import('./hydration-state');
  resetImageHydration();
  resetArticleHydration();
});
```

- [ ] **Step 2: Run tests — confirm new tests fail**

Run: `pnpm test hydration-state`

- [ ] **Step 3: Add `articleHydration` and reset helper**

Edit `app/src/lib/hydration-state.ts`. Below the existing `imageHydration` and `resetImageHydration`, add:

```ts
export const articleHydration: Writable<HydrationProgress> = writable(INITIAL);

export function resetArticleHydration(): void {
  articleHydration.set(INITIAL);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test hydration-state`

Expected: 6/6 passing (was 3; +3 new).

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 139 → 142.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(hydration-state): add articleHydration store"
```

DO NOT push.

---

## Task 4: `article-hydrator.ts` — background loop with inventory mutation

Async loop. For each unhydrated article URL: call the fetcher, write `article_text` (and optionally `article_title`) onto the corresponding save, persist the inventory back to IDB at the end of the run. Updates `articleHydration` as it goes. Respects `AbortSignal`.

**Files:**
- Create: `app/src/lib/article-hydrator.ts`
- Create: `app/src/lib/article-hydrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/article-hydrator.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';

beforeEach(async () => {
  const { clearInventory } = await import('./inventory-store');
  await clearInventory();
  const { resetArticleHydration } = await import('./hydration-state');
  resetArticleHydration();
});

const makeInventory = () => ({
  saves: [
    {
      uri: 'a',
      embed: { url: 'https://example.com/a' },
    },
    {
      uri: 'b',
      embed: { url: 'https://example.com/b' },
    },
    {
      uri: 'c',
      embed: { url: 'https://example.com/c' },
      article_text: 'already there',
    },
  ],
});

describe('hydrateArticles happy path', () => {
  it('fetches each unhydrated URL and writes article_text + title onto each save', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      url,
      title: `Title for ${url}`,
      text: `Body for ${url}`,
      fetched_at: '2026-05-04T12:00:00Z',
    }));
    const inv = makeInventory();
    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(inv, { fetcher });
    expect(result).toEqual({ fetched: 2, skipped: 1, failed: 0, cancelled: false });
    expect((inv.saves[0] as Record<string, unknown>).article_text).toBe('Body for https://example.com/a');
    expect((inv.saves[0] as Record<string, unknown>).article_title).toBe('Title for https://example.com/a');
    expect((inv.saves[1] as Record<string, unknown>).article_text).toBe('Body for https://example.com/b');
    expect((inv.saves[2] as Record<string, unknown>).article_text).toBe('already there'); // untouched
  });

  it('persists the mutated inventory to IDB at the end', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      url,
      title: 't',
      text: 't',
      fetched_at: '2026-05-04T12:00:00Z',
    }));
    const inv = makeInventory();
    const { hydrateArticles } = await import('./article-hydrator');
    await hydrateArticles(inv, { fetcher });
    const { loadInventory } = await import('./inventory-store');
    const fromDb = (await loadInventory()) as { saves: Array<Record<string, unknown>> };
    expect(fromDb.saves[0].article_text).toBe('t');
  });

  it('updates articleHydration store progressively', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      url,
      title: 't',
      text: 't',
      fetched_at: '2026-05-04T12:00:00Z',
    }));
    const { hydrateArticles } = await import('./article-hydrator');
    const { articleHydration } = await import('./hydration-state');
    await hydrateArticles(makeInventory(), { fetcher });
    const final = get(articleHydration);
    expect(final.status).toBe('done');
    expect(final.total).toBe(2);
    expect(final.fetched).toBe(2);
    expect(final.skipped).toBe(1);
  });
});

describe('hydrateArticles records failures without aborting', () => {
  it('continues past failed URLs', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://example.com/a') throw new Error('paywall');
      return { url, title: 't', text: 't', fetched_at: '2026-05-04T12:00:00Z' };
    });
    const inv = makeInventory();
    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(inv, { fetcher });
    expect(result).toEqual({ fetched: 1, skipped: 1, failed: 1, cancelled: false });
    expect((inv.saves[0] as Record<string, unknown>).article_text).toBeUndefined();
    expect((inv.saves[1] as Record<string, unknown>).article_text).toBe('t');
    const { articleHydration } = await import('./hydration-state');
    expect(get(articleHydration).failures).toEqual([
      { url: 'https://example.com/a', reason: 'paywall' },
    ]);
  });
});

describe('hydrateArticles cancellation', () => {
  it('exits cleanly between iterations when signal is aborted', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      calls++;
      if (calls === 1) controller.abort();
      return { url, title: 't', text: 't', fetched_at: '2026-05-04T12:00:00Z' };
    });
    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(makeInventory(), {
      fetcher,
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    const { articleHydration } = await import('./hydration-state');
    expect(get(articleHydration).status).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test article-hydrator`

- [ ] **Step 3: Implement the module**

Create `app/src/lib/article-hydrator.ts`:

```ts
// Background loop that walks an inventory's article URLs, extracts each via
// the helper, and mutates the inventory in place: writes article_text and
// (when present) article_title onto each save. Persists the updated inventory
// back to IDB once the run completes. Updates articleHydration as it goes.
//
// Articles are stored INSIDE the inventory (not a separate store) to match
// bsky-saves' CLI shape and the existing parser's article synthesis.

import { extractArticleUrls } from './extract-article-urls';
import { extractArticleViaHelper, type ExtractedArticle } from './helper-client';
import { config } from './config';
import { saveInventory } from './inventory-store';
import { articleHydration, type HydrationFailure } from './hydration-state';

export interface HydrateArticleResult {
  readonly fetched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

export interface HydrateArticleOptions {
  /** Inject a fetcher for testing. Defaults to the real helper extractor. */
  readonly fetcher?: (url: string) => Promise<ExtractedArticle>;
  readonly signal?: AbortSignal;
}

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function findSaveByUrl(inventory: unknown, url: string): Record<string, unknown> | null {
  if (!inventory || typeof inventory !== 'object') return null;
  const inv = inventory as { saves?: unknown };
  if (!Array.isArray(inv.saves)) return null;
  for (const save of inv.saves) {
    if (!save || typeof save !== 'object') continue;
    const s = save as Record<string, unknown>;
    const embed = s.embed;
    if (embed && typeof embed === 'object') {
      const e = embed as Record<string, unknown>;
      if (e.url === url) return s;
    }
  }
  return null;
}

export async function hydrateArticles(
  inventory: unknown,
  options: HydrateArticleOptions = {},
): Promise<HydrateArticleResult> {
  const fetcher =
    options.fetcher ?? ((url: string) => extractArticleViaHelper(config.helperOrigin, url));
  const signal = options.signal;

  const allUrls: string[] = [];
  if (inventory && typeof inventory === 'object') {
    const inv = inventory as { saves?: unknown };
    if (Array.isArray(inv.saves)) {
      // Count saves with article_text === string AS skipped, but count saves
      // whose embed.url is missing as neither skipped nor fetched.
      for (const save of inv.saves) {
        if (!save || typeof save !== 'object') continue;
        const s = save as Record<string, unknown>;
        const embed = s.embed;
        if (!embed || typeof embed !== 'object') continue;
        const url = (embed as Record<string, unknown>).url;
        if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
        allUrls.push(url);
      }
    }
  }
  const urlsToFetch = extractArticleUrls(inventory);
  const skipped = allUrls.length - urlsToFetch.length;

  articleHydration.set({
    status: urlsToFetch.length === 0 ? 'done' : 'running',
    total: urlsToFetch.length,
    fetched: 0,
    skipped,
    failed: 0,
    failures: [],
  });

  let fetched = 0;
  let failed = 0;

  for (const url of urlsToFetch) {
    if (signal?.aborted) {
      articleHydration.update((s) => ({ ...s, status: 'cancelled' }));
      // Persist whatever we did so far.
      try {
        await saveInventory(inventory);
      } catch {
        // best-effort persist
      }
      return { fetched, skipped, failed, cancelled: true };
    }

    try {
      const result = await fetcher(url);
      const save = findSaveByUrl(inventory, url);
      if (save) {
        save.article_text = result.text;
        if (result.title) save.article_title = result.title;
      }
      fetched++;
      articleHydration.update((s) => ({ ...s, fetched: s.fetched + 1 }));
    } catch (err) {
      const failure: HydrationFailure = { url, reason: reasonOf(err) };
      failed++;
      articleHydration.update((s) => ({
        ...s,
        failed: s.failed + 1,
        failures: [...s.failures, failure],
      }));
    }
  }

  // Persist the mutated inventory once at the end of the run.
  try {
    await saveInventory(inventory);
  } catch {
    // If persistence fails, the in-memory mutation still benefits the current
    // session; a future run can re-fetch what didn't land.
  }

  articleHydration.update((s) => ({ ...s, status: 'done' }));
  return { fetched, skipped, failed, cancelled: false };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test article-hydrator`

Expected: 5/5 passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 142 → 147.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(article-hydrator): background loop, mutates inventory + persists"
```

DO NOT push.

---

## Task 5: `start-article-backup.ts` — run lifecycle helper

Mirror `start-image-backup.ts` for articles. Probes for the helper specifically (user-worker can't extract articles in v1). Refuses with a clear reason if not available. Sets `enabled = true` for articles on success. Cancels via AbortController.

**Files:**
- Create: `app/src/lib/start-article-backup.ts`
- Create: `app/src/lib/start-article-backup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/start-article-backup.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  const { clearInventory } = await import('./inventory-store');
  await clearInventory();
  const { resetArticleHydration } = await import('./hydration-state');
  resetArticleHydration();
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

const okExtract = {
  ok: true,
  json: async () => ({
    url: 'https://example.com/a',
    title: 't',
    text: 'body',
    fetched_at: '2026-05-04T12:00:00Z',
  }),
};

const sampleInventory = () => ({
  saves: [{ uri: 'a', embed: { url: 'https://example.com/a' } }],
});

describe('startArticleBackup', () => {
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

  it('returns {started: true} when helper is available and runs the loop', async () => {
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing;
        return okExtract;
      }),
    );
    const { startArticleBackup } = await import('./start-article-backup');
    const { articleHydration } = await import('./hydration-state');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(true);
    await vi.waitUntil(() => get(articleHydration).status === 'done', { timeout: 1000 });
    expect(get(articleHydration).fetched).toBe(1);
  });

  it('flips backup-prefs.articles.enabled = true on successful start', async () => {
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing;
        return okExtract;
      }),
    );
    const { startArticleBackup } = await import('./start-article-backup');
    const { loadBackupPrefs } = await import('./backup-prefs');
    await startArticleBackup(sampleInventory());
    await vi.waitUntil(async () => (await loadBackupPrefs()).articles.enabled, { timeout: 1000 });
    expect((await loadBackupPrefs()).articles.enabled).toBe(true);
  });

  it('cancelArticleBackup aborts the run', async () => {
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing;
        await new Promise((r) => setTimeout(r, 50));
        return okExtract;
      }),
    );
    const { startArticleBackup, cancelArticleBackup } = await import('./start-article-backup');
    const { articleHydration } = await import('./hydration-state');
    const inv = {
      saves: [
        { uri: '1', embed: { url: 'https://example.com/1' } },
        { uri: '2', embed: { url: 'https://example.com/2' } },
        { uri: '3', embed: { url: 'https://example.com/3' } },
      ],
    };
    const result = await startArticleBackup(inv);
    expect(result.started).toBe(true);
    await vi.waitUntil(() => get(articleHydration).fetched >= 1, { timeout: 1000 });
    cancelArticleBackup();
    await vi.waitUntil(() => get(articleHydration).status === 'cancelled', { timeout: 1000 });
  });

  it('cancelArticleBackup is a safe no-op when nothing is running', async () => {
    const { cancelArticleBackup } = await import('./start-article-backup');
    expect(() => cancelArticleBackup()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test start-article-backup`

- [ ] **Step 3: Implement the module**

Create `app/src/lib/start-article-backup.ts`:

```ts
// Run-lifecycle helper for article backup. Wraps article-hydrator with the
// controls the UI needs:
//
// - startArticleBackup(inventory): probes the helper specifically (article
//   extraction needs server-side trafilatura, which the user-worker template
//   doesn't run). Returns {started:false, reason} if no helper. Otherwise
//   spawns the hydration loop and returns {started:true}.
//
// - cancelArticleBackup(): aborts the most recent run, or no-op.

import { probeConfiguredHelper } from './helper-client';
import { hydrateArticles } from './article-hydrator';
import { setBackupEnabled } from './backup-prefs';

export interface StartArticleResult {
  readonly started: boolean;
  readonly reason?: string;
}

let activeController: AbortController | null = null;

export async function startArticleBackup(inventory: unknown): Promise<StartArticleResult> {
  const helper = await probeConfiguredHelper();
  if (helper.status !== 'available') {
    return {
      started: false,
      reason:
        'Article backup needs the local bsky-saves helper. ' +
        'Install bsky-saves and run `bsky-saves serve`. ' +
        'Cloudflare Worker proxies do not yet support article extraction.',
    };
  }
  if (!helper.features.includes('extract-article')) {
    return {
      started: false,
      reason: `Local helper (bsky-saves ${helper.version}) does not advertise article extraction. Update bsky-saves.`,
    };
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

- [ ] **Step 4: Run tests**

Run: `pnpm test start-article-backup`

Expected: 5/5 passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 errors. Total goes 147 → 152.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(start-article-backup): run lifecycle helper for articles (helper-only)"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors, 0 warnings. ~152 tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

Plan 9 ships the article hydration engine without UI. To trigger it from the GUI today, you'd need to call `startArticleBackup(currentInventory)` from a custom button or DevTools.

Plan 10 candidates (small, scoped):
- **Articles row in Settings → Backup section** — mirrors the Images row: status, Disable, the existing "Don't ask me about article backup" toggle. Plus a "Set up article backup" button when not enabled, which calls `startArticleBackup`.
- **Article-backup banner** — like image banner but for articles. Per the design spec, image banner shows first; article banner waits until image is dealt with.
- **`BackupStatusRow` extension** — show article counters alongside image counters.

The PostFocus footer and Show Details modal can layer on top after the trigger UX exists.
