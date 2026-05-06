# Plan 27: live article rendering + self-contained HTML export with images

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Two fixes from real-world testing.

1. After article hydration, `PostBody` doesn't see the new article text because the hydrator writes `save.article_text` while the renderer reads `save.article.text`. Fix the hydrator to also write `save.article`.
2. The HTML export injects only the inventory JSON. Saved image blobs live in IDB (per-browser); on another machine the export has nothing to show. Embed all saved blobs in the export as a base64 map, and have the archive's image resolver consult that map first.

**Architecture:** Article hydrator writes `save.article = { url, text, title? }` alongside the existing flat fields. New `gather-image-blobs.ts` helper walks the inventory's image URLs, loads each blob from IDB, and returns a `{ [url]: { mime, data_b64 } }` map. `html-exporter.ts` injects this map into a new `<script type="application/json" id="image-blobs">` tag in the archive shell. `image-resolver.ts` gains an in-memory `embeddedBlobMap` and a `registerEmbeddedBlobs` function; the archive bootstrap reads the script tag and registers the map. The resolver checks the embedded map (returning a `data:` URI) before the IDB lookup.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest, Vite. No new dependencies (FileReader is built-in).

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `ab21d34` or later.

---

## File structure

**Created:**
- `app/src/lib/gather-image-blobs.ts` — pure async helper; takes inventory + IDB-loader; returns `{ [url]: { mime, data_b64 } }`.
- `app/src/lib/gather-image-blobs.test.ts` — unit tests.

**Modified:**
- `app/src/lib/article-hydrator.ts` — also writes `save.article`.
- `app/src/lib/article-hydrator.test.ts` — assert `save.article.text` is populated.
- `app/src/lib/image-resolver.ts` — adds `registerEmbeddedBlobs` + in-memory cache; resolver checks it first.
- `app/src/lib/image-resolver.test.ts` — assert embedded map takes precedence.
- `app/src/exporters/html-exporter.ts` — injects an `image-blobs` script tag with the gathered map.
- `app/src/exporters/html-exporter.test.ts` — covers the new injection.
- `archive-template/index.html` — add `<script type="application/json" id="image-blobs">{}</script>`.
- `app/src/archive/ArchiveApp.svelte` — onMount reads the `image-blobs` script and calls `registerEmbeddedBlobs`.

---

## Task 1: Article hydrator writes `save.article`

**Files:**
- Modify: `app/src/lib/article-hydrator.ts`
- Modify: `app/src/lib/article-hydrator.test.ts`

- [ ] **Step 1: Add the failing test**

In `app/src/lib/article-hydrator.test.ts`, append inside the existing describe block:

```ts
  it('also writes save.article so the renderer sees the new article text', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      if (u.endsWith('/ping')) {
        return {
          ok: true,
          json: async () => ({ name: 'bsky-saves', version: '0.3.0', features: ['extract-article'] }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          url: 'https://a.example/p',
          title: 'Hello',
          text: 'body text',
          fetched_at: '2026-05-05T00:00:00Z',
        }),
      };
    }));
    const inv = { saves: [{ uri: 'a', embed: { url: 'https://a.example/p' } } as Record<string, unknown>] };
    const { hydrateArticles } = await import('./article-hydrator');
    await hydrateArticles(inv);
    const save = inv.saves[0];
    expect(save.article_text).toBe('body text');
    expect(save.article).toEqual({ url: 'https://a.example/p', text: 'body text', title: 'Hello' });
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run app/src/lib/article-hydrator.test.ts -t "save.article"
```

Expected: failure — `save.article` is undefined.

- [ ] **Step 3: Update the hydrator**

In `app/src/lib/article-hydrator.ts`, find:

```ts
      const result = await fetcher(url);
      const save = findSaveByUrl(inventory, url);
      if (save) {
        save.article_text = result.text;
        if (result.title) save.article_title = result.title;
      }
```

Replace with:

```ts
      const result = await fetcher(url);
      const save = findSaveByUrl(inventory, url);
      if (save) {
        save.article_text = result.text;
        if (result.title) save.article_title = result.title;
        save.article = {
          url: result.url,
          text: result.text,
          ...(result.title ? { title: result.title } : {}),
        };
      }
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm test
```

Expected: 0 errors, 0 warnings; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/article-hydrator.ts app/src/lib/article-hydrator.test.ts
git commit -m "fix(article-hydrator): also write save.article so PostBody renders fresh text"
```

DO NOT push.

---

## Task 2: `gather-image-blobs` helper + tests

**Files:**
- Create: `app/src/lib/gather-image-blobs.ts`
- Create: `app/src/lib/gather-image-blobs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/gather-image-blobs.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
});

describe('gatherImageBlobs', () => {
  it('returns an empty map when no blobs are saved', async () => {
    const { gatherImageBlobs } = await import('./gather-image-blobs');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }],
    };
    const out = await gatherImageBlobs(inv);
    expect(out).toEqual({});
  });

  it('returns base64-encoded blobs for saved URLs', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['hello'], { type: 'image/png' }));
    const { gatherImageBlobs } = await import('./gather-image-blobs');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }],
    };
    const out = await gatherImageBlobs(inv);
    expect(Object.keys(out)).toEqual(['https://i/1']);
    expect(out['https://i/1'].mime).toBe('image/png');
    // 'hello' base64 is 'aGVsbG8='
    expect(out['https://i/1'].data_b64).toBe('aGVsbG8=');
  });

  it('skips URLs without saved blobs', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['x'], { type: 'image/png' }));
    const { gatherImageBlobs } = await import('./gather-image-blobs');
    const inv = {
      saves: [
        { uri: 'a', images: [{ url: 'https://i/1' }, { url: 'https://i/2' }] },
      ],
    };
    const out = await gatherImageBlobs(inv);
    expect(Object.keys(out)).toEqual(['https://i/1']);
  });

  it('uses application/octet-stream when blob.type is empty', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['x']));
    const { gatherImageBlobs } = await import('./gather-image-blobs');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }],
    };
    const out = await gatherImageBlobs(inv);
    expect(out['https://i/1'].mime).toBe('application/octet-stream');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run app/src/lib/gather-image-blobs.test.ts
```

Expected: import resolution failure.

- [ ] **Step 3: Create `app/src/lib/gather-image-blobs.ts`**

```ts
import { extractImageUrls } from './extract-image-urls';
import { loadImageBlob } from './image-store';

export interface EmbeddedBlob {
  readonly mime: string;
  readonly data_b64: string;
}

export type EmbeddedBlobMap = Readonly<Record<string, EmbeddedBlob>>;

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx === -1 ? '' : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Walk an inventory's image URLs, load each saved blob from IDB, and return
 * a map of url → { mime, data_b64 }. URLs without a saved blob are skipped.
 *
 * Used by the HTML exporter to embed image data directly into the export so
 * the resulting file is self-contained when opened on another machine.
 */
export async function gatherImageBlobs(inventory: unknown): Promise<EmbeddedBlobMap> {
  const urls = extractImageUrls(inventory);
  const out: Record<string, EmbeddedBlob> = {};
  for (const url of urls) {
    let blob: Blob | undefined;
    try {
      blob = await loadImageBlob(url);
    } catch {
      blob = undefined;
    }
    if (!blob) continue;
    const data_b64 = await blobToBase64(blob);
    const mime = blob.type !== '' ? blob.type : 'application/octet-stream';
    out[url] = { mime, data_b64 };
  }
  return out;
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/gather-image-blobs.test.ts
```

Expected: 0 errors, 0 warnings; 4/4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/gather-image-blobs.ts app/src/lib/gather-image-blobs.test.ts
git commit -m "feat(gather-image-blobs): collect saved image blobs as a base64 map"
```

DO NOT push.

---

## Task 3: `image-resolver` checks an embedded blob map

**Files:**
- Modify: `app/src/lib/image-resolver.ts`
- Modify: `app/src/lib/image-resolver.test.ts`

- [ ] **Step 1: Add the failing test**

In `app/src/lib/image-resolver.test.ts`, append inside the existing describe block:

```ts
  it('uses an embedded blob (data URI) when one is registered for the URL', async () => {
    const { registerEmbeddedBlobs, resolveImageSrc, clearEmbeddedBlobs } = await import('./image-resolver');
    registerEmbeddedBlobs({
      'https://i/embedded': { mime: 'image/png', data_b64: 'aGVsbG8=' },
    });
    try {
      const r = await resolveImageSrc('https://i/embedded');
      expect(r.src).toBe('data:image/png;base64,aGVsbG8=');
      expect(r.isBlob).toBe(false);
    } finally {
      clearEmbeddedBlobs();
    }
  });

  it('falls back to IDB then remote when no embedded blob is registered', async () => {
    const { resolveImageSrc, clearEmbeddedBlobs } = await import('./image-resolver');
    clearEmbeddedBlobs();
    const r = await resolveImageSrc('https://i/not-embedded');
    expect(r.src).toBe('https://i/not-embedded');
    expect(r.isBlob).toBe(false);
  });
```

(If the file currently has no describe block, wrap the new tests in one along with any existing tests.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run app/src/lib/image-resolver.test.ts
```

Expected: failure — `registerEmbeddedBlobs` not exported.

- [ ] **Step 3: Update `app/src/lib/image-resolver.ts`**

Replace the file contents with:

```ts
// Render-time lookup that bridges image-store (IDB blob cache), an in-memory
// "embedded blob" map (used by exported archives where IDB starts empty),
// and the remote URL. Returns the URL the GUI should hand to <img src=...>.
//
// Caller owns the blob URL lifecycle: when isBlob is true, revoke the src
// via URL.revokeObjectURL when the consumer is destroyed. Embedded data:
// URIs don't need revoking and report isBlob: false.

import { loadImageBlob } from './image-store';

export interface ResolvedImage {
  readonly src: string;
  readonly isBlob: boolean;
}

interface EmbeddedBlob {
  readonly mime: string;
  readonly data_b64: string;
}

let embeddedBlobs: Record<string, EmbeddedBlob> = {};

/**
 * Register a map of url → { mime, data_b64 } for use by `resolveImageSrc`.
 * Used by the archive bootstrap when the page is opened from an exported
 * HTML file. Subsequent calls replace the registered map (idempotent).
 */
export function registerEmbeddedBlobs(map: Record<string, EmbeddedBlob>): void {
  embeddedBlobs = { ...map };
}

/**
 * Clear the registered embedded-blob map. Test hook.
 */
export function clearEmbeddedBlobs(): void {
  embeddedBlobs = {};
}

export async function resolveImageSrc(remoteUrl: string): Promise<ResolvedImage> {
  const embedded = embeddedBlobs[remoteUrl];
  if (embedded) {
    return { src: `data:${embedded.mime};base64,${embedded.data_b64}`, isBlob: false };
  }
  try {
    const blob = await loadImageBlob(remoteUrl);
    if (blob) {
      return { src: URL.createObjectURL(blob), isBlob: true };
    }
  } catch {
    // IDB unavailable (private mode, quota, etc.) — fall through to remote.
  }
  return { src: remoteUrl, isBlob: false };
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/image-resolver.test.ts
```

Expected: 0 errors, 0 warnings; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/image-resolver.ts app/src/lib/image-resolver.test.ts
git commit -m "feat(image-resolver): consult registered embedded-blob map before IDB"
```

DO NOT push.

---

## Task 4: HTML exporter injects the embedded-blob map

**Files:**
- Modify: `app/src/exporters/html-exporter.ts`
- Modify: `app/src/exporters/html-exporter.test.ts`
- Modify: `archive-template/index.html`

- [ ] **Step 1: Add the `image-blobs` script tag to the archive shell**

Open `archive-template/index.html`. Find:

```html
    <script type="application/json" id="inventory">
      {"saves":[]}
    </script>
```

Insert another script tag immediately after (before the module script):

```html
    <script type="application/json" id="inventory">
      {"saves":[]}
    </script>
    <script type="application/json" id="image-blobs">
      {}
    </script>
```

- [ ] **Step 2: Add the failing test**

In `app/src/exporters/html-exporter.test.ts`, find the existing test that asserts the inventory is injected. Add a new test below it:

```ts
  it('injects the gathered image-blob map into the image-blobs script tag', async () => {
    const { saveImageBlob } = await import('../lib/image-store');
    await saveImageBlob('https://i/1', new Blob(['hi'], { type: 'image/png' }));

    // Replace global fetch with one that returns the test shell containing
    // both script tags. Match the shape used in the existing test for
    // injecting the inventory.
    const shellHtml = `<!doctype html>
<html><body>
<script type="application/json" id="inventory">
{"saves":[]}
</script>
<script type="application/json" id="image-blobs">
{}
</script>
</body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(shellHtml, { status: 200 })));
    try {
      const { exportHtml } = await import('./html-exporter');
      const inv = {
        saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }],
      };
      const r = await exportHtml(inv as any);
      const text = await r.blob.text();
      const m = /<script type="application\/json" id="image-blobs">([\s\S]*?)<\/script>/.exec(text);
      expect(m).not.toBeNull();
      const parsed = JSON.parse(m![1]);
      expect(parsed['https://i/1']).toBeDefined();
      expect(parsed['https://i/1'].mime).toBe('image/png');
      expect(parsed['https://i/1'].data_b64).toBe('aGk=');
    } finally {
      vi.unstubAllGlobals();
    }
  });
```

(Adjust imports at the top of the test file as needed: add `vi` if not already imported; add `import 'fake-indexeddb/auto';` if not present.)

- [ ] **Step 3: Run tests to verify the new test fails**

```bash
pnpm vitest run app/src/exporters/html-exporter.test.ts
```

Expected: failure — exporter doesn't yet inject `image-blobs`.

- [ ] **Step 4: Update `app/src/exporters/html-exporter.ts`**

Replace the file contents with:

```ts
import type { Inventory } from '../reader/inventory-shape';
import { gatherImageBlobs } from '../lib/gather-image-blobs';

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

const ARCHIVE_URL = '/archive-template/index.html';
const INVENTORY_RE = /(<script type="application\/json" id="inventory">)[\s\S]*?(<\/script>)/;
const IMAGE_BLOBS_RE = /(<script type="application\/json" id="image-blobs">)[\s\S]*?(<\/script>)/;

function injectInventory(html: string, inventory: Inventory): string {
  const json = JSON.stringify(inventory).replace(/<\/script/gi, '<\\/script');
  if (!INVENTORY_RE.test(html)) {
    throw new Error('Archive shell missing inventory script tag');
  }
  return html.replace(INVENTORY_RE, (_match, openTag, closeTag) =>
    `${openTag}\n${json}\n${closeTag}`,
  );
}

function injectImageBlobs(html: string, blobs: unknown): string {
  const json = JSON.stringify(blobs).replace(/<\/script/gi, '<\\/script');
  if (!IMAGE_BLOBS_RE.test(html)) {
    throw new Error('Archive shell missing image-blobs script tag');
  }
  return html.replace(IMAGE_BLOBS_RE, (_match, openTag, closeTag) =>
    `${openTag}\n${json}\n${closeTag}`,
  );
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

export async function exportHtml(inventory: Inventory): Promise<ExportResult> {
  const shell = await fetchText(ARCHIVE_URL);
  const blobs = await gatherImageBlobs(inventory);
  const withInventory = injectInventory(shell, inventory);
  const withBlobs = injectImageBlobs(withInventory, blobs);
  return {
    blob: new Blob([withBlobs], { type: 'text/html' }),
    filename: 'saves-archive.html',
  };
}
```

- [ ] **Step 5: Run check + tests**

```bash
pnpm check && pnpm test
```

Expected: 0 errors, 0 warnings; all tests pass (the existing inventory-injection test should keep passing because the regex still matches its tag).

- [ ] **Step 6: Commit**

```bash
git add app/src/exporters/html-exporter.ts app/src/exporters/html-exporter.test.ts archive-template/index.html
git commit -m "feat(html-exporter): embed saved image blobs as base64 map in the export"
```

DO NOT push.

---

## Task 5: Archive bootstrap registers the embedded-blob map

**Files:**
- Modify: `app/src/archive/ArchiveApp.svelte`

- [ ] **Step 1: Update `ArchiveApp.svelte`**

Open `app/src/archive/ArchiveApp.svelte`. Add an import at the top of the script:

```svelte
  import { registerEmbeddedBlobs } from '$lib/image-resolver';
```

Change `readInline` so it also reads the `image-blobs` script (extract a small helper for clarity):

```svelte
  function readInline(): Inventory {
    const el = document.getElementById('inventory');
    if (!el) throw new Error('No inline inventory script');
    return parseInventory(JSON.parse(el.textContent ?? '{}'));
  }

  function readImageBlobs(): Record<string, { mime: string; data_b64: string }> {
    const el = document.getElementById('image-blobs');
    if (!el) return {};
    try {
      const parsed = JSON.parse(el.textContent ?? '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, { mime: string; data_b64: string }>;
      }
    } catch {
      // Malformed JSON: silently fall back to no embedded blobs.
    }
    return {};
  }
```

In `onMount`, register the blobs before applying the hash:

```svelte
  onMount(() => {
    try {
      registerEmbeddedBlobs(readImageBlobs());
      inventory = readInline();
      applyHash();
      const handler = () => applyHash();
      window.addEventListener('hashchange', handler);
      return () => window.removeEventListener('hashchange', handler);
    } catch (e) {
      view.set({ name: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });
```

- [ ] **Step 2: Run check + build**

```bash
pnpm check && pnpm build
```

Expected: 0 errors, 0 warnings; both bundles build (including `dist/archive-template/index.html` which now contains the new script tag).

- [ ] **Step 3: Commit**

```bash
git add app/src/archive/ArchiveApp.svelte
git commit -m "feat(ArchiveApp): register embedded image-blobs on mount"
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

- Article hydrator writes `save.article = { url, text, title? }` alongside the flat fields. PostBody renders fresh article text without re-parsing the inventory.
- `gatherImageBlobs` returns base64-encoded saved blobs keyed by URL.
- Image resolver checks an injected map before IDB; live app behavior unchanged when no map is registered.
- HTML exporter gathers blobs and injects them into a new `<script type="application/json" id="image-blobs">` tag. Archive shell has the tag with `{}` default.
- Archive bootstrap reads the script and registers the map before mounting routes.
- All existing tests still pass; new tests for the helper, resolver, and exporter.
- Five commits, in order.
- `pnpm check && pnpm test && pnpm build` clean.

## What's next

Plan 27 closes both bug reports. The HTML export is now self-contained for images. Saved articles render live as soon as hydration writes them. A follow-up could persist hydration failures across full-page reload (currently they only survive SPA navigation), but that's a separate spec.
