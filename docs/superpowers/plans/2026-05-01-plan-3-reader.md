# Plan 3 — Reader: Library Feed, Search, Filters, Post Focus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Library and Post placeholders with a real, navigable reader. After Plan 3, a user who has run a fetch (Plan 2) lands in a chronological feed, can search by text/author and filter by date range, click a post to slide into a full-screen focus view, and use the back chevron or browser back to return. Components live under `app/src/reader/` so Plan 4's archive build can reuse them verbatim.

**Architecture:** Shared `reader/` component package. Pure-logic helpers (`feed-filter`, `format`, `inventory-shape`) tested with vitest. Route wrappers (`Library.svelte`, `Post.svelte`) load inventory from IndexedDB and mount the shared components. A small `slide-transition.ts` Svelte action provides slide-from-right; `prefers-reduced-motion` collapses it to a fade.

**Tech Stack:** Existing Svelte/Vite/TS stack. No new runtime deps. Svelte's built-in `transition:fly` powers the slide.

**Reference:** [Design spec](../specs/2026-05-01-bsky-saves-gui-design.md) — components and user-flow sections.

---

## File Structure

```
app/src/
├── reader/                              # shared with archive build (Plan 4)
│   ├── inventory-shape.ts               # types + narrowing helpers
│   ├── inventory-shape.test.ts
│   ├── feed-filter.ts                   # pure: filter saves by query + date range
│   ├── feed-filter.test.ts
│   ├── format.ts                        # date and handle formatting helpers
│   ├── format.test.ts
│   ├── PostCard.svelte                  # one row in the feed
│   ├── PostBody.svelte                  # renders post text + image gallery + link card
│   ├── SearchBar.svelte                 # bound to a query string
│   ├── DateRangeFilter.svelte           # bound to from/to dates
│   ├── LibraryView.svelte               # composition: filter UI + virtualised feed
│   └── PostFocus.svelte                 # full post + thread descendants + article text
├── lib/
│   ├── inventory-loader.ts              # Svelte store wrapping inventory-store
│   └── inventory-loader.test.ts
├── lib/slide-transition.ts              # Svelte action for slide-from-right with reduced-motion
└── routes/
    ├── Library.svelte                   # route wrapper: load → mount LibraryView
    └── Post.svelte                      # route wrapper: load → mount PostFocus by rkey
```

---

## Task 1: Inventory shape types

The bsky-saves inventory shape is fixed by upstream. Encode it as TypeScript types so all subsequent reader code is type-checked. The implementer should briefly read `bsky-saves` source (especially `bsky_saves/fetch.py`) to confirm field names. Treat unknown extras as opaque.

**Files:**
- Create: `app/src/reader/inventory-shape.ts`
- Create: `app/src/reader/inventory-shape.test.ts`

- [ ] **Step 1: Verify field names**

Read https://github.com/tenorune/bsky-saves/blob/main/bsky_saves/fetch.py (and adjacent files) to confirm the shape of `saves_inventory.json`. Expected fields per save (subject to confirmation):

- `uri` — at:// URI
- `cid` — content hash
- `author` — `{ did, handle, displayName?, avatar? }`
- `record` — `{ text, createdAt, langs?, facets?, embed? }`
- `embed?` — view of embedded images, external links, etc.
- `indexedAt` — ISO timestamp
- Hydration extras (optional, present after enrich/hydrate):
  - `enriched_created_at?` — ISO string from enrich
  - `article?` — `{ url, title?, text }` from hydrate articles
  - `thread?` — array of descendant post views
  - `local_images?` — `[{ cid, path }]` from hydrate images

If any field name differs from the above, prefer the upstream name and note the deviation in a top-of-file comment.

- [ ] **Step 2: Write the failing test**

```ts
// app/src/reader/inventory-shape.test.ts
import { describe, expect, it } from 'vitest';

describe('inventory-shape', () => {
  it('parseInventory accepts a minimal valid object and rejects garbage', async () => {
    const { parseInventory, ParseError } = await import('./inventory-shape');

    const ok = parseInventory({
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/3l00',
          cid: 'cid1',
          author: { did: 'did:plc:abc', handle: 'alice.bsky.social' },
          record: { text: 'hi', createdAt: '2026-04-01T12:00:00Z' },
          indexedAt: '2026-04-01T12:00:00Z',
        },
      ],
    });
    expect(ok.saves).toHaveLength(1);

    expect(() => parseInventory({})).toThrow(ParseError);
    expect(() => parseInventory({ saves: 'not-an-array' })).toThrow(ParseError);
    expect(() => parseInventory(null)).toThrow(ParseError);
  });

  it('rkeyOf extracts the trailing segment from an at-uri', async () => {
    const { rkeyOf } = await import('./inventory-shape');
    expect(rkeyOf('at://did:plc:abc/app.bsky.feed.post/3l00')).toBe('3l00');
    expect(rkeyOf('at://did:plc:abc/app.bsky.feed.post/abc-123')).toBe('abc-123');
  });

  it('preserves unknown extras through parse', async () => {
    const { parseInventory } = await import('./inventory-shape');
    const got = parseInventory({
      saves: [
        {
          uri: 'at://x/y/z',
          cid: 'c',
          author: { did: 'd', handle: 'h' },
          record: { text: 't', createdAt: '2026-01-01T00:00:00Z' },
          indexedAt: '2026-01-01T00:00:00Z',
          custom_extension: { weird: 'value' },
        },
      ],
    });
    expect((got.saves[0] as any).custom_extension).toEqual({ weird: 'value' });
  });
});
```

- [ ] **Step 3: Implement `app/src/reader/inventory-shape.ts`**

```ts
export interface Author {
  readonly did: string;
  readonly handle: string;
  readonly displayName?: string;
  readonly avatar?: string;
}

export interface PostRecord {
  readonly text: string;
  readonly createdAt: string;
  readonly langs?: readonly string[];
  // Other fields (facets, embed) preserved as unknown extras.
  readonly [extra: string]: unknown;
}

export interface ArticleHydration {
  readonly url: string;
  readonly title?: string;
  readonly text: string;
}

export interface ThreadEntry {
  readonly uri: string;
  readonly cid: string;
  readonly author: Author;
  readonly record: PostRecord;
  readonly [extra: string]: unknown;
}

export interface LocalImage {
  readonly cid: string;
  readonly path: string;
}

export interface Save {
  readonly uri: string;
  readonly cid: string;
  readonly author: Author;
  readonly record: PostRecord;
  readonly indexedAt: string;
  readonly embed?: unknown;
  readonly enriched_created_at?: string;
  readonly article?: ArticleHydration;
  readonly thread?: readonly ThreadEntry[];
  readonly local_images?: readonly LocalImage[];
  readonly [extra: string]: unknown;
}

export interface Inventory {
  readonly saves: readonly Save[];
  readonly [extra: string]: unknown;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new ParseError(`${ctx}.${key} is not a string`);
  }
  return v;
}

function parseAuthor(v: unknown): Author {
  if (!isObject(v)) throw new ParseError('author is not an object');
  return {
    did: requireString(v, 'did', 'author'),
    handle: requireString(v, 'handle', 'author'),
    displayName: typeof v.displayName === 'string' ? v.displayName : undefined,
    avatar: typeof v.avatar === 'string' ? v.avatar : undefined,
  };
}

function parseRecord(v: unknown): PostRecord {
  if (!isObject(v)) throw new ParseError('record is not an object');
  return {
    ...v,
    text: requireString(v, 'text', 'record'),
    createdAt: requireString(v, 'createdAt', 'record'),
    langs: Array.isArray(v.langs) ? (v.langs.filter((x) => typeof x === 'string') as string[]) : undefined,
  };
}

function parseSave(v: unknown): Save {
  if (!isObject(v)) throw new ParseError('save is not an object');
  return {
    ...v,
    uri: requireString(v, 'uri', 'save'),
    cid: requireString(v, 'cid', 'save'),
    indexedAt: requireString(v, 'indexedAt', 'save'),
    author: parseAuthor(v.author),
    record: parseRecord(v.record),
  };
}

export function parseInventory(input: unknown): Inventory {
  if (!isObject(input)) throw new ParseError('inventory root is not an object');
  if (!Array.isArray(input.saves)) throw new ParseError('inventory.saves is not an array');
  return {
    ...input,
    saves: input.saves.map(parseSave),
  };
}

const RKEY_RE = /\/([^/]+)$/;

export function rkeyOf(uri: string): string {
  const m = RKEY_RE.exec(uri);
  if (!m) throw new ParseError(`uri has no rkey segment: ${uri}`);
  return m[1];
}
```

- [ ] **Step 4: Run tests, expect pass.** 3 new + 28 existing = 31.

- [ ] **Step 5: Commit**

```bash
git add app/src/reader/inventory-shape.ts app/src/reader/inventory-shape.test.ts
git commit -m "feat(reader): inventory shape types with parser and rkey helper"
```

---

## Task 2: Feed filter and format helpers

Pure-logic modules with full TDD coverage. Used by `LibraryView` and (in Plan 4) by the archive build's templating.

**Files:**
- Create: `app/src/reader/feed-filter.ts`
- Create: `app/src/reader/feed-filter.test.ts`
- Create: `app/src/reader/format.ts`
- Create: `app/src/reader/format.test.ts`

- [ ] **Step 1: feed-filter test**

```ts
// app/src/reader/feed-filter.test.ts
import { describe, expect, it } from 'vitest';
import type { Save } from './inventory-shape';

function s(uri: string, text: string, handle: string, createdAt: string): Save {
  return {
    uri,
    cid: 'c',
    author: { did: 'd', handle },
    record: { text, createdAt },
    indexedAt: createdAt,
  };
}

describe('filterSaves', () => {
  const saves: Save[] = [
    s('at://x/y/1', 'hello world', 'alice.bsky.social', '2026-04-01T00:00:00Z'),
    s('at://x/y/2', 'goodbye world', 'bob.example', '2026-04-15T00:00:00Z'),
    s('at://x/y/3', 'lunch?', 'alice.bsky.social', '2026-05-01T00:00:00Z'),
  ];

  it('returns all saves when query is empty and no date range', async () => {
    const { filterSaves } = await import('./feed-filter');
    expect(filterSaves(saves, { query: '', from: null, to: null })).toEqual(saves);
  });

  it('filters by case-insensitive substring across post text and handle', async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(saves, { query: 'BOB', from: null, to: null });
    expect(r).toHaveLength(1);
    expect(r[0].author.handle).toBe('bob.example');

    const r2 = filterSaves(saves, { query: 'world', from: null, to: null });
    expect(r2).toHaveLength(2);
  });

  it('filters by from-date (inclusive) using the post createdAt', async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(saves, { query: '', from: '2026-04-15', to: null });
    expect(r.map((x) => x.uri)).toEqual(['at://x/y/2', 'at://x/y/3']);
  });

  it('filters by to-date (inclusive end-of-day)', async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(saves, { query: '', from: null, to: '2026-04-15' });
    expect(r.map((x) => x.uri)).toEqual(['at://x/y/1', 'at://x/y/2']);
  });

  it('combines query with date range', async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(saves, { query: 'alice', from: '2026-04-15', to: null });
    expect(r.map((x) => x.uri)).toEqual(['at://x/y/3']);
  });
});

describe('sortByCreatedDesc', () => {
  it('sorts saves newest-first by record.createdAt', async () => {
    const { sortByCreatedDesc } = await import('./feed-filter');
    const sorted = sortByCreatedDesc([
      s('a', 't', 'h', '2026-04-01T00:00:00Z'),
      s('b', 't', 'h', '2026-05-01T00:00:00Z'),
      s('c', 't', 'h', '2026-04-15T00:00:00Z'),
    ]);
    expect(sorted.map((x) => x.uri)).toEqual(['b', 'c', 'a']);
  });
});
```

- [ ] **Step 2: Implement `app/src/reader/feed-filter.ts`**

```ts
import type { Save } from './inventory-shape';

export interface FilterParams {
  readonly query: string;
  readonly from: string | null; // YYYY-MM-DD or null
  readonly to: string | null;   // YYYY-MM-DD or null
}

function matchesQuery(save: Save, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    save.record.text.toLowerCase().includes(needle) ||
    save.author.handle.toLowerCase().includes(needle) ||
    (save.author.displayName?.toLowerCase().includes(needle) ?? false)
  );
}

function matchesFrom(save: Save, from: string | null): boolean {
  if (!from) return true;
  return save.record.createdAt >= `${from}T00:00:00Z`;
}

function matchesTo(save: Save, to: string | null): boolean {
  if (!to) return true;
  // Inclusive: anything before next-day midnight UTC.
  return save.record.createdAt <= `${to}T23:59:59.999Z`;
}

export function filterSaves(saves: readonly Save[], params: FilterParams): Save[] {
  return saves.filter(
    (s) =>
      matchesQuery(s, params.query) &&
      matchesFrom(s, params.from) &&
      matchesTo(s, params.to),
  );
}

export function sortByCreatedDesc(saves: readonly Save[]): Save[] {
  return [...saves].sort((a, b) =>
    a.record.createdAt < b.record.createdAt ? 1 : a.record.createdAt > b.record.createdAt ? -1 : 0,
  );
}
```

- [ ] **Step 3: Run feed-filter tests, expect pass.**

- [ ] **Step 4: format test**

```ts
// app/src/reader/format.test.ts
import { describe, expect, it } from 'vitest';

describe('format', () => {
  it('formatDate renders ISO timestamps as YYYY-MM-DD', async () => {
    const { formatDate } = await import('./format');
    expect(formatDate('2026-04-15T12:34:56Z')).toBe('2026-04-15');
  });

  it('formatDateTime renders ISO timestamps as a friendly string', async () => {
    const { formatDateTime } = await import('./format');
    // Locale-dependent; just check that something non-empty and contains the year.
    const out = formatDateTime('2026-04-15T12:34:56Z');
    expect(out).toMatch(/2026/);
    expect(out.length).toBeGreaterThan(4);
  });

  it('formatHandle prefixes with @', async () => {
    const { formatHandle } = await import('./format');
    expect(formatHandle('alice.bsky.social')).toBe('@alice.bsky.social');
    expect(formatHandle('@alice.bsky.social')).toBe('@alice.bsky.social');
  });

  it('handlesAuthor prefers displayName, falls back to handle', async () => {
    const { formatAuthor } = await import('./format');
    expect(formatAuthor({ did: 'd', handle: 'h.example', displayName: 'Hubert' })).toBe('Hubert');
    expect(formatAuthor({ did: 'd', handle: 'h.example' })).toBe('h.example');
  });
});
```

- [ ] **Step 5: Implement `app/src/reader/format.ts`**

```ts
import type { Author } from './inventory-shape';

export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatHandle(handle: string): string {
  return handle.startsWith('@') ? handle : `@${handle}`;
}

export function formatAuthor(author: Author): string {
  return author.displayName?.trim() || author.handle;
}
```

- [ ] **Step 6: Run all tests, expect pass.** 4 + 6 = 10 new, total 38.

- [ ] **Step 7: Commit**

```bash
git add app/src/reader/feed-filter.ts app/src/reader/feed-filter.test.ts app/src/reader/format.ts app/src/reader/format.test.ts
git commit -m "feat(reader): feed filter and format helpers"
```

---

## Task 3: Inventory loader store

A Svelte store that exposes the inventory loaded from IndexedDB. Wraps `loadInventory()` from `lib/inventory-store.ts`. Used by route wrappers.

**Files:**
- Create: `app/src/lib/inventory-loader.ts`
- Create: `app/src/lib/inventory-loader.test.ts`

- [ ] **Step 1: Test**

```ts
// app/src/lib/inventory-loader.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';

describe('inventoryLoader', () => {
  beforeEach(async () => {
    const { clearInventory } = await import('./inventory-store');
    await clearInventory();
    // Reset the loader module so its initial-load runs fresh per test.
    const { resetForTests } = await import('./inventory-loader');
    resetForTests();
  });

  it('starts in loading state, then resolves to null when nothing is stored', async () => {
    const { inventoryState, loadFromDb } = await import('./inventory-loader');
    expect(get(inventoryState).status).toBe('loading');
    await loadFromDb();
    expect(get(inventoryState)).toEqual({ status: 'empty' });
  });

  it('resolves to ready with the stored inventory', async () => {
    const { saveInventory } = await import('./inventory-store');
    await saveInventory({
      saves: [
        {
          uri: 'at://x/y/1',
          cid: 'c',
          author: { did: 'd', handle: 'h.example' },
          record: { text: 't', createdAt: '2026-04-01T00:00:00Z' },
          indexedAt: '2026-04-01T00:00:00Z',
        },
      ],
    });
    const { inventoryState, loadFromDb } = await import('./inventory-loader');
    await loadFromDb();
    const state = get(inventoryState);
    expect(state.status).toBe('ready');
    if (state.status === 'ready') {
      expect(state.inventory.saves).toHaveLength(1);
    }
  });

  it('reports parseError when stored data is malformed', async () => {
    const { saveInventory } = await import('./inventory-store');
    await saveInventory({ totally: 'not-an-inventory' });
    const { inventoryState, loadFromDb } = await import('./inventory-loader');
    await loadFromDb();
    const state = get(inventoryState);
    expect(state.status).toBe('error');
  });
});
```

- [ ] **Step 2: Implement `app/src/lib/inventory-loader.ts`**

```ts
import { writable, type Readable } from 'svelte/store';
import { loadInventory } from './inventory-store';
import { parseInventory, type Inventory } from '../reader/inventory-shape';

export type InventoryState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; inventory: Inventory }
  | { status: 'error'; message: string };

const store = writable<InventoryState>({ status: 'loading' });
export const inventoryState: Readable<InventoryState> = { subscribe: store.subscribe };

export async function loadFromDb(): Promise<void> {
  store.set({ status: 'loading' });
  const raw = await loadInventory();
  if (raw === null) {
    store.set({ status: 'empty' });
    return;
  }
  try {
    const inventory = parseInventory(raw);
    store.set({ status: 'ready', inventory });
  } catch (e) {
    store.set({
      status: 'error',
      message: e instanceof Error ? e.message : 'Failed to parse inventory',
    });
  }
}

/** For tests only — resets the store to its initial state. */
export function resetForTests(): void {
  store.set({ status: 'loading' });
}
```

- [ ] **Step 3: Run, expect pass.** 3 new, total 41.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/inventory-loader.ts app/src/lib/inventory-loader.test.ts
git commit -m "feat(reader): inventory loader store"
```

---

## Task 4: PostBody and PostCard components

`PostBody` renders a single post's text, image gallery, and link card embeds. `PostCard` is the feed row that uses `PostBody` plus author + timestamp + click handler.

**Files:**
- Create: `app/src/reader/PostBody.svelte`
- Create: `app/src/reader/PostCard.svelte`

These are presentational. No tests — covered by integration via `LibraryView` smoke check.

- [ ] **Step 1: Create `app/src/reader/PostBody.svelte`**

```svelte
<script lang="ts">
  import type { Save } from './inventory-shape';

  export let save: Save;

  type ImageEmbedView = { thumb?: string; fullsize?: string; alt?: string };

  $: text = save.record.text;
  $: localImages = save.local_images ?? [];
  $: embedImages = ((): ImageEmbedView[] => {
    const e = save.embed as { images?: ImageEmbedView[] } | undefined;
    return Array.isArray(e?.images) ? (e!.images as ImageEmbedView[]) : [];
  })();
</script>

<div class="post-body">
  {#if text}
    <p class="post-body__text">{text}</p>
  {/if}

  {#if localImages.length > 0}
    <div class="post-body__images">
      {#each localImages as img}
        <img src={img.path} alt="" loading="lazy" />
      {/each}
    </div>
  {:else if embedImages.length > 0}
    <div class="post-body__images">
      {#each embedImages as img}
        <img src={img.fullsize ?? img.thumb} alt={img.alt ?? ''} loading="lazy" />
      {/each}
    </div>
  {/if}

  {#if save.article}
    <details class="post-body__article">
      <summary>Linked article{save.article.title ? `: ${save.article.title}` : ''}</summary>
      <p>{save.article.text}</p>
    </details>
  {/if}
</div>

<style>
  .post-body__text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .post-body__images {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .post-body__images img {
    width: 100%;
    border-radius: 6px;
    object-fit: cover;
  }
  .post-body__article {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    border-radius: 6px;
    font-size: 0.9em;
  }
  .post-body__article summary {
    cursor: pointer;
    font-weight: 500;
  }
  .post-body__article p {
    margin: 0.5rem 0 0;
    white-space: pre-wrap;
  }
</style>
```

- [ ] **Step 2: Create `app/src/reader/PostCard.svelte`**

```svelte
<script lang="ts">
  import type { Save } from './inventory-shape';
  import { formatAuthor, formatDateTime, formatHandle } from './format';
  import PostBody from './PostBody.svelte';

  export let save: Save;
  export let onSelect: (save: Save) => void;
</script>

<article class="post-card">
  <button
    type="button"
    class="post-card__button"
    on:click={() => onSelect(save)}
    aria-label="Open post"
  >
    <header class="post-card__header">
      <span class="post-card__author">{formatAuthor(save.author)}</span>
      <span class="post-card__handle">{formatHandle(save.author.handle)}</span>
      <time class="post-card__time" datetime={save.record.createdAt}>
        {formatDateTime(save.record.createdAt)}
      </time>
    </header>
    <PostBody {save} />
  </button>
</article>

<style>
  .post-card {
    border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 8px;
    margin-bottom: 0.75rem;
    overflow: hidden;
  }
  .post-card__button {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    width: 100%;
    padding: 1rem;
    cursor: pointer;
  }
  .post-card__button:hover {
    background: color-mix(in oklab, CanvasText 4%, Canvas);
  }
  .post-card__header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }
  .post-card__author {
    font-weight: 600;
  }
  .post-card__handle {
    opacity: 0.7;
  }
  .post-card__time {
    margin-left: auto;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
</style>
```

- [ ] **Step 3: Verify it compiles**

`pnpm check` — 0 errors. (Svelte components are checked when imported; until the next task imports them, this just confirms parse.)

- [ ] **Step 4: Commit**

```bash
git add app/src/reader/PostBody.svelte app/src/reader/PostCard.svelte
git commit -m "feat(reader): PostBody and PostCard presentational components"
```

---

## Task 5: SearchBar and DateRangeFilter components

Bound input components consumed by `LibraryView`.

**Files:**
- Create: `app/src/reader/SearchBar.svelte`
- Create: `app/src/reader/DateRangeFilter.svelte`

- [ ] **Step 1: SearchBar**

```svelte
<!-- app/src/reader/SearchBar.svelte -->
<script lang="ts">
  export let value = '';
  export let placeholder = 'Search posts and authors…';
</script>

<label class="search-bar">
  <span class="search-bar__label">Search</span>
  <input
    type="search"
    bind:value
    {placeholder}
    autocomplete="off"
    spellcheck="false"
  />
</label>

<style>
  .search-bar {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .search-bar__label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }
  input {
    font: inherit;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
</style>
```

- [ ] **Step 2: DateRangeFilter**

```svelte
<!-- app/src/reader/DateRangeFilter.svelte -->
<script lang="ts">
  export let from: string | null = null;
  export let to: string | null = null;

  function fromInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    from = v.length > 0 ? v : null;
  }
  function toInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    to = v.length > 0 ? v : null;
  }
</script>

<fieldset class="date-range">
  <legend>Date range</legend>
  <label>
    From
    <input type="date" value={from ?? ''} on:input={fromInput} />
  </label>
  <label>
    To
    <input type="date" value={to ?? ''} on:input={toInput} />
  </label>
</fieldset>

<style>
  .date-range {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 0.75rem;
    align-items: end;
  }
  .date-range legend {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
    padding: 0;
    margin-bottom: 0.25rem;
  }
  .date-range label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  input {
    font: inherit;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 20%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
  }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add app/src/reader/SearchBar.svelte app/src/reader/DateRangeFilter.svelte
git commit -m "feat(reader): SearchBar and DateRangeFilter input components"
```

---

## Task 6: LibraryView composition

Composes filter UI + filtered + sorted feed.

**Files:**
- Create: `app/src/reader/LibraryView.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import type { Inventory, Save } from './inventory-shape';
  import { filterSaves, sortByCreatedDesc } from './feed-filter';
  import PostCard from './PostCard.svelte';
  import SearchBar from './SearchBar.svelte';
  import DateRangeFilter from './DateRangeFilter.svelte';

  export let inventory: Inventory;
  export let onSelectPost: (save: Save) => void;

  let query = '';
  let from: string | null = null;
  let to: string | null = null;

  $: sorted = sortByCreatedDesc(inventory.saves);
  $: visible = filterSaves(sorted, { query, from, to });
</script>

<section class="library-view">
  <header class="library-view__filters">
    <SearchBar bind:value={query} />
    <DateRangeFilter bind:from bind:to />
    <p class="library-view__count" aria-live="polite">
      Showing {visible.length} of {inventory.saves.length}
    </p>
  </header>

  {#if visible.length === 0}
    <p class="library-view__empty">No saves match your filters.</p>
  {:else}
    <ul class="library-view__feed">
      {#each visible as save (save.uri)}
        <li>
          <PostCard {save} onSelect={onSelectPost} />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .library-view__filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: end;
    margin-bottom: 1.5rem;
  }
  .library-view__count {
    margin: 0 0 0 auto;
    font-size: 0.875rem;
    opacity: 0.8;
  }
  .library-view__feed {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .library-view__empty {
    opacity: 0.7;
    font-style: italic;
  }
</style>
```

- [ ] **Step 2: Verify type check**

`pnpm check` — 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/reader/LibraryView.svelte
git commit -m "feat(reader): LibraryView with search, date range, sorted feed"
```

---

## Task 7: PostFocus component

Renders one post in detail, with thread descendants beneath.

**Files:**
- Create: `app/src/reader/PostFocus.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import type { Save } from './inventory-shape';
  import { formatAuthor, formatDateTime, formatHandle } from './format';
  import PostBody from './PostBody.svelte';

  export let save: Save;

  $: thread = save.thread ?? [];
  $: bskyUrl = (() => {
    // Best-effort link to the original post on bsky.app: at://did/coll/rkey → /profile/handle/post/rkey
    const m = /\/([^/]+)$/.exec(save.uri);
    const rkey = m?.[1] ?? '';
    return `https://bsky.app/profile/${encodeURIComponent(save.author.handle)}/post/${encodeURIComponent(rkey)}`;
  })();
</script>

<article class="post-focus">
  <header class="post-focus__header">
    <h2>{formatAuthor(save.author)}</h2>
    <p class="post-focus__handle">
      {formatHandle(save.author.handle)}
      <span class="post-focus__sep">·</span>
      <time datetime={save.record.createdAt}>{formatDateTime(save.record.createdAt)}</time>
    </p>
  </header>

  <PostBody {save} />

  <p class="post-focus__link">
    <a href={bskyUrl} target="_blank" rel="noopener noreferrer">View on bsky.app</a>
  </p>

  {#if thread.length > 0}
    <section class="post-focus__thread">
      <h3>Thread</h3>
      <ol>
        {#each thread as entry (entry.uri)}
          <li>
            <header>
              <strong>{formatAuthor(entry.author)}</strong>
              <span class="post-focus__handle">{formatHandle(entry.author.handle)}</span>
              <time datetime={entry.record.createdAt}>{formatDateTime(entry.record.createdAt)}</time>
            </header>
            <p class="post-focus__thread-text">{entry.record.text}</p>
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</article>

<style>
  .post-focus {
    max-width: 44rem;
    margin: 0 auto;
  }
  .post-focus__header h2 {
    margin: 0 0 0.25rem;
  }
  .post-focus__handle {
    margin: 0;
    opacity: 0.75;
    font-size: 0.95em;
  }
  .post-focus__sep {
    margin: 0 0.4em;
  }
  .post-focus__link {
    margin-top: 1rem;
    font-size: 0.9em;
  }
  .post-focus__thread {
    margin-top: 2rem;
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    padding-top: 1rem;
  }
  .post-focus__thread h3 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }
  .post-focus__thread ol {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .post-focus__thread li {
    border-left: 3px solid color-mix(in oklab, CanvasText 15%, transparent);
    padding: 0.5rem 0 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
  }
  .post-focus__thread header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    font-size: 0.875rem;
  }
  .post-focus__thread time {
    margin-left: auto;
    opacity: 0.7;
  }
  .post-focus__thread-text {
    margin: 0.25rem 0 0;
    white-space: pre-wrap;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add app/src/reader/PostFocus.svelte
git commit -m "feat(reader): PostFocus full-post view with thread"
```

---

## Task 8: Slide transition action

A reusable action that animates a route's mount-in slide. Honors `prefers-reduced-motion` by collapsing to a fade.

**Files:**
- Create: `app/src/lib/slide-transition.ts`

- [ ] **Step 1: Implement**

```ts
import type { Action } from 'svelte/action';

export const slideFromRight: Action<HTMLElement> = (node) => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduce ? 120 : 280;
  const transform = reduce ? 'translateX(0)' : 'translateX(100%)';

  node.animate(
    [
      { transform, opacity: reduce ? 0 : 1 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    { duration, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'both' },
  );

  return {};
};
```

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/slide-transition.ts
git commit -m "feat(reader): slide-from-right action with reduced-motion fallback"
```

---

## Task 9: Wire `Library.svelte` and `Post.svelte` route wrappers

Replace placeholders with route wrappers that load inventory and render the shared reader components, plus the slide transition.

**Files:**
- Modify: `app/src/routes/Library.svelte`
- Modify: `app/src/routes/Post.svelte`

- [ ] **Step 1: Library.svelte**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { navigate } from '$lib/router';
  import { slideFromRight } from '$lib/slide-transition';
  import LibraryView from '../reader/LibraryView.svelte';
  import { rkeyOf } from '../reader/inventory-shape';
  import type { Save } from '../reader/inventory-shape';

  onMount(() => {
    if (get(inventoryState).status === 'loading') {
      void loadFromDb();
    }
  });

  function open(save: Save): void {
    navigate(`/post/${rkeyOf(save.uri)}`);
  }
</script>

<section class="route route--library" use:slideFromRight>
  <header class="route__header">
    <button type="button" class="route__back" on:click={() => navigate('/')}>← Sign in</button>
    <h2>Library</h2>
  </header>

  {#if $inventoryState.status === 'loading'}
    <p>Loading inventory…</p>
  {:else if $inventoryState.status === 'empty'}
    <p>
      No inventory yet. <a href="#/">Sign in</a> to fetch your saves.
    </p>
  {:else if $inventoryState.status === 'error'}
    <p class="error">Failed to load inventory: {$inventoryState.message}</p>
    <button type="button" on:click={() => loadFromDb()}>Retry</button>
  {:else}
    <LibraryView inventory={$inventoryState.inventory} onSelectPost={open} />
  {/if}
</section>

<style>
  .route__header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .route__back {
    background: none;
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
  }
</style>
```

- [ ] **Step 2: Post.svelte**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { currentRoute, navigate } from '$lib/router';
  import { slideFromRight } from '$lib/slide-transition';
  import PostFocus from '../reader/PostFocus.svelte';
  import { rkeyOf } from '../reader/inventory-shape';

  onMount(() => {
    if (get(inventoryState).status === 'loading') {
      void loadFromDb();
    }
  });

  $: rkey = $currentRoute.params.rkey ?? '';
  $: save = (() => {
    const s = $inventoryState;
    if (s.status !== 'ready') return null;
    return s.inventory.saves.find((x) => rkeyOf(x.uri) === rkey) ?? null;
  })();
</script>

<section class="route route--post" use:slideFromRight>
  <header class="route__header">
    <button type="button" class="route__back" on:click={() => navigate('/library')}>← Library</button>
    <h2>Post</h2>
  </header>

  {#if $inventoryState.status === 'loading'}
    <p>Loading…</p>
  {:else if $inventoryState.status !== 'ready'}
    <p>No inventory available. <a href="#/">Sign in</a>.</p>
  {:else if save === null}
    <p>Post <code>{rkey}</code> not found in your inventory.</p>
    <button type="button" on:click={() => navigate('/library')}>Back to library</button>
  {:else}
    <PostFocus {save} />
  {/if}
</section>

<style>
  .route__header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .route__back {
    background: none;
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
  }
</style>
```

- [ ] **Step 3: Verify**

```bash
pnpm check        # 0 errors
pnpm test         # all existing tests still pass (no new tests)
pnpm build        # success
```

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/Library.svelte app/src/routes/Post.svelte
git commit -m "feat(reader): wire Library and Post routes with slide transition"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

```bash
pnpm test
```

Expected: ~41 tests across atproto, crypto, inventory-store, credentials-store, pyodide-runner, engine, router, config, inventory-shape, feed-filter, format, inventory-loader.

- [ ] **Step 2: Type check + build**

```bash
pnpm check
pnpm build
```

Both clean.

- [ ] **Step 3: Manual smoke**

```bash
pnpm dev
```

If you have a stored inventory in IndexedDB (from a real Plan 2 sign-in), navigate to `#/library`. Verify:
- The feed renders.
- Search filters posts by text/author.
- Date range filters.
- Clicking a post slides into `#/post/<rkey>` with the focus view.
- Browser back returns to library.
- The "← Library" / "← Sign in" buttons also navigate.

If no inventory: the empty-state messaging shows and the link back to sign-in works.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Live deploy updates `saves.lightseed.net`.

---

## Done criteria

After Plan 3:

1. The Library route shows a real chronological feed of saves loaded from IndexedDB.
2. Search box filters by post text, handle, or display name (case-insensitive).
3. Date range filter works on `record.createdAt`.
4. Clicking a post navigates to `#/post/<rkey>` with a slide-from-right transition.
5. The Post route renders text, images (local or CDN), article hydration if present, link to original, thread descendants if present.
6. Empty-state and error-state messaging exists for "no inventory" and "post not found."
7. `prefers-reduced-motion` collapses the slide to a fade.
8. All unit tests pass; type check is clean; build is clean.
9. Reader components live entirely under `app/src/reader/` so Plan 4 can reuse them in the archive build.

Plan 4 will use these same components to generate self-contained HTML archives.
