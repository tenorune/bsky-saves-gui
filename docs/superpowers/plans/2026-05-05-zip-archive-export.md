# Plan 28: ZIP archive export when image blobs exist

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** When the user exports the archive, return a single self-contained `saves-archive.html` if no image blobs are saved, or a `saves-archive.zip` containing a lean HTML shell + `inventory.json` + `images/{sha256}.{ext}` files when blobs exist. Image filenames inside the ZIP use the SHA-256 hex of the source URL.

**Architecture:** New pure helpers `mime-to-ext.ts` and `gather-image-files.ts` (the latter walks inventory URLs, loads each blob from IDB, computes a SHA-256 of the URL, returns `{url, filename, blob}[]`). `image-resolver.ts` gains a `registerLocalImagePaths(map)` hook returning relative paths. The archive shell gains a `<script type="application/json" id="local-image-paths">` tag; `ArchiveApp.svelte` reads it on mount and registers the map before the resolver is queried. `html-exporter.ts` becomes `archive-exporter.ts` (or stays under the same filename/exported function name) and branches: zero blobs → existing HTML single-file path with the new path map empty; some blobs → JSZip-built `.zip` containing the lean HTML, `inventory.json`, and `images/`.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest. Existing `jszip` dependency. Web Crypto API (`crypto.subtle.digest`) for SHA-256.

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `aac205b` or later.

---

## File structure

**Created:**
- `app/src/lib/mime-to-ext.ts` — `mimeToExt(mime: string): string`.
- `app/src/lib/mime-to-ext.test.ts`.
- `app/src/lib/gather-image-files.ts` — async helper returning `{url, filename, blob}[]`.
- `app/src/lib/gather-image-files.test.ts`.

**Modified:**
- `app/src/lib/image-resolver.ts` — add `registerLocalImagePaths` + `clearLocalImagePaths`; resolver checks the map first.
- `app/src/lib/image-resolver.test.ts` — assertions for the new hook.
- `archive-template/index.html` — add `<script type="application/json" id="local-image-paths">{}</script>`.
- `app/src/archive/ArchiveApp.svelte` — read the new tag and call `registerLocalImagePaths`.
- `app/src/exporters/html-exporter.ts` — rename `exportHtml` to `exportArchive`; branch HTML vs ZIP based on blob presence.
- `app/src/exporters/html-exporter.test.ts` — split tests into "no blobs → HTML" and "with blobs → ZIP" paths.
- `app/src/components/ExportMenu.svelte` — call `exportArchive`; rename the menu item label to `Export archive` for accuracy.

---

## Task 1: `mime-to-ext` helper + tests

**Files:**
- Create: `app/src/lib/mime-to-ext.ts`
- Create: `app/src/lib/mime-to-ext.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/mime-to-ext.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mimeToExt } from './mime-to-ext';

describe('mimeToExt', () => {
  it('maps common image mime types', () => {
    expect(mimeToExt('image/png')).toBe('png');
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('image/webp')).toBe('webp');
    expect(mimeToExt('image/gif')).toBe('gif');
    expect(mimeToExt('image/avif')).toBe('avif');
    expect(mimeToExt('image/svg+xml')).toBe('svg');
    expect(mimeToExt('image/heic')).toBe('heic');
    expect(mimeToExt('image/heif')).toBe('heif');
  });

  it('is case-insensitive', () => {
    expect(mimeToExt('Image/PNG')).toBe('png');
    expect(mimeToExt('IMAGE/JPEG')).toBe('jpg');
  });

  it('strips parameters after a semicolon', () => {
    expect(mimeToExt('image/png; charset=binary')).toBe('png');
  });

  it('falls back to "bin" for unknown types', () => {
    expect(mimeToExt('application/octet-stream')).toBe('bin');
    expect(mimeToExt('')).toBe('bin');
    expect(mimeToExt('weird/format')).toBe('bin');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run app/src/lib/mime-to-ext.test.ts
```

Expected: import resolution failure.

- [ ] **Step 3: Create `app/src/lib/mime-to-ext.ts`**

```ts
const TABLE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Map a MIME type to a short file extension. Falls back to `bin` for unknown
 * types. Case-insensitive; ignores any `;`-separated parameters.
 */
export function mimeToExt(mime: string): string {
  const head = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return TABLE[head] ?? 'bin';
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/mime-to-ext.test.ts
```

Expected: 0 errors, 0 warnings; 4/4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/mime-to-ext.ts app/src/lib/mime-to-ext.test.ts
git commit -m "feat(mime-to-ext): map MIME types to short file extensions"
```

DO NOT push.

---

## Task 2: `gather-image-files` helper + tests

**Files:**
- Create: `app/src/lib/gather-image-files.ts`
- Create: `app/src/lib/gather-image-files.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/gather-image-files.test.ts` (use Node test environment because we round-trip Blobs through fake-indexeddb):

```ts
// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
});

describe('gatherImageFiles', () => {
  it('returns an empty array when no blobs are saved', async () => {
    const { gatherImageFiles } = await import('./gather-image-files');
    const inv = { saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }] };
    expect(await gatherImageFiles(inv)).toEqual([]);
  });

  it('returns one entry per saved URL with SHA-256 hex filenames and correct extensions', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['png-bytes'], { type: 'image/png' }));
    await saveImageBlob('https://i/2', new Blob(['jpg-bytes'], { type: 'image/jpeg' }));
    const { gatherImageFiles } = await import('./gather-image-files');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }, { url: 'https://i/2' }] }],
    };
    const out = await gatherImageFiles(inv);
    expect(out.length).toBe(2);
    const byUrl = new Map(out.map((e) => [e.url, e] as const));
    const e1 = byUrl.get('https://i/1');
    expect(e1).toBeDefined();
    expect(e1!.filename).toMatch(/^[0-9a-f]{64}\.png$/);
    const e2 = byUrl.get('https://i/2');
    expect(e2).toBeDefined();
    expect(e2!.filename).toMatch(/^[0-9a-f]{64}\.jpg$/);
  });

  it('produces stable filenames across calls (same URL → same filename)', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/stable', new Blob(['x'], { type: 'image/png' }));
    const { gatherImageFiles } = await import('./gather-image-files');
    const inv = { saves: [{ uri: 'a', images: [{ url: 'https://i/stable' }] }] };
    const a = await gatherImageFiles(inv);
    const b = await gatherImageFiles(inv);
    expect(a[0].filename).toBe(b[0].filename);
  });

  it('skips URLs without a saved blob', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['x'], { type: 'image/png' }));
    const { gatherImageFiles } = await import('./gather-image-files');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }, { url: 'https://i/missing' }] }],
    };
    const out = await gatherImageFiles(inv);
    expect(out.map((e) => e.url)).toEqual(['https://i/1']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run app/src/lib/gather-image-files.test.ts
```

Expected: import resolution failure.

- [ ] **Step 3: Create `app/src/lib/gather-image-files.ts`**

```ts
import { extractImageUrls } from './extract-image-urls';
import { loadImageBlob } from './image-store';
import { mimeToExt } from './mime-to-ext';

export interface GatheredImageFile {
  readonly url: string;
  readonly filename: string;
  readonly blob: Blob;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(hash);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Walk an inventory's image URLs, load each saved blob from IDB, and return
 * a list of `{url, filename, blob}` entries. Filenames are derived from
 * SHA-256(url) + an extension chosen via the blob's MIME type, so they're
 * stable across calls and across exports of the same inventory.
 *
 * URLs without a saved blob are skipped. Output is sorted by URL for
 * deterministic ordering.
 */
export async function gatherImageFiles(
  inventory: unknown,
): Promise<GatheredImageFile[]> {
  const urls = [...extractImageUrls(inventory)].sort();
  const out: GatheredImageFile[] = [];
  for (const url of urls) {
    let blob: Blob | undefined;
    try {
      blob = await loadImageBlob(url);
    } catch {
      blob = undefined;
    }
    if (!blob) continue;
    const hash = await sha256Hex(url);
    const ext = mimeToExt(blob.type);
    out.push({ url, filename: `${hash}.${ext}`, blob });
  }
  return out;
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm check && pnpm vitest run app/src/lib/gather-image-files.test.ts
```

Expected: 0 errors, 0 warnings; 4/4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/gather-image-files.ts app/src/lib/gather-image-files.test.ts
git commit -m "feat(gather-image-files): list saved blobs as {url, sha256-filename, blob}"
```

DO NOT push.

---

## Task 3: `image-resolver` consults a local-image-paths map

**Files:**
- Modify: `app/src/lib/image-resolver.ts`
- Modify: `app/src/lib/image-resolver.test.ts`

- [ ] **Step 1: Add the failing tests**

In `app/src/lib/image-resolver.test.ts`, append:

```ts
  it('uses a registered local path (relative URL) when present for the URL', async () => {
    const { registerLocalImagePaths, resolveImageSrc, clearLocalImagePaths, clearEmbeddedBlobs } = await import('./image-resolver');
    clearEmbeddedBlobs();
    registerLocalImagePaths({
      'https://i/local': 'images/abc.png',
    });
    try {
      const r = await resolveImageSrc('https://i/local');
      expect(r.src).toBe('images/abc.png');
      expect(r.isBlob).toBe(false);
    } finally {
      clearLocalImagePaths();
    }
  });

  it('local paths take precedence over embedded blobs', async () => {
    const { registerLocalImagePaths, registerEmbeddedBlobs, resolveImageSrc, clearLocalImagePaths, clearEmbeddedBlobs } = await import('./image-resolver');
    registerEmbeddedBlobs({ 'https://i/both': { mime: 'image/png', data_b64: 'aGVsbG8=' } });
    registerLocalImagePaths({ 'https://i/both': 'images/zzz.png' });
    try {
      const r = await resolveImageSrc('https://i/both');
      expect(r.src).toBe('images/zzz.png');
    } finally {
      clearEmbeddedBlobs();
      clearLocalImagePaths();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run app/src/lib/image-resolver.test.ts
```

Expected: failure — `registerLocalImagePaths` not exported.

- [ ] **Step 3: Update `app/src/lib/image-resolver.ts`**

Replace the file contents with:

```ts
// Render-time lookup that bridges (in priority order):
//   1. A registered "local image paths" map — used by ZIP exports where each
//      URL maps to a relative path like `images/abc.png`.
//   2. A registered "embedded blob" map — used by single-file HTML exports
//      where each URL maps to base64 bytes returned as a `data:` URI.
//   3. The IDB blob cache — the live app's primary store.
//   4. The remote URL — final fallback when nothing local exists.
//
// Caller owns the blob URL lifecycle: when isBlob is true, revoke the src via
// URL.revokeObjectURL when the consumer is destroyed. data: URIs and relative
// paths report isBlob: false (no revoke needed).

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
let localImagePaths: Record<string, string> = {};

export function registerEmbeddedBlobs(map: Record<string, EmbeddedBlob>): void {
  embeddedBlobs = { ...map };
}

export function clearEmbeddedBlobs(): void {
  embeddedBlobs = {};
}

export function registerLocalImagePaths(map: Record<string, string>): void {
  localImagePaths = { ...map };
}

export function clearLocalImagePaths(): void {
  localImagePaths = {};
}

export async function resolveImageSrc(remoteUrl: string): Promise<ResolvedImage> {
  const localPath = localImagePaths[remoteUrl];
  if (localPath) {
    return { src: localPath, isBlob: false };
  }
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
git commit -m "feat(image-resolver): consult local-image-paths map (for ZIP exports)"
```

DO NOT push.

---

## Task 4: Archive shell + bootstrap reads the path map

**Files:**
- Modify: `archive-template/index.html`
- Modify: `app/src/archive/ArchiveApp.svelte`

- [ ] **Step 1: Add the script tag in the shell**

In `archive-template/index.html`, find:

```html
    <script type="application/json" id="image-blobs">
      {}
    </script>
```

Insert immediately above it (so the order in the document is `inventory`, then `local-image-paths`, then `image-blobs`):

```html
    <script type="application/json" id="local-image-paths">
      {}
    </script>
```

The final order in the body should be:

```html
    <script type="application/json" id="inventory">…</script>
    <script type="application/json" id="local-image-paths">…</script>
    <script type="application/json" id="image-blobs">…</script>
    <script type="module" src="/app/src/archive/main.ts"></script>
```

- [ ] **Step 2: Update `ArchiveApp.svelte` to register the path map**

In `app/src/archive/ArchiveApp.svelte`, add to the imports near the existing `registerEmbeddedBlobs` import:

```svelte
  import { registerEmbeddedBlobs, registerLocalImagePaths } from '$lib/image-resolver';
```

Add a reader function below `readImageBlobs`:

```svelte
  function readLocalImagePaths(): Record<string, string> {
    const el = document.getElementById('local-image-paths');
    if (!el) return {};
    try {
      const parsed = JSON.parse(el.textContent ?? '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') out[k] = v;
        }
        return out;
      }
    } catch {
      // Malformed JSON: silently fall back to no local paths.
    }
    return {};
  }
```

In `onMount`, register both maps before applying hash. Replace:

```svelte
      registerEmbeddedBlobs(readImageBlobs());
```

with:

```svelte
      registerLocalImagePaths(readLocalImagePaths());
      registerEmbeddedBlobs(readImageBlobs());
```

- [ ] **Step 3: Run check + build**

```bash
pnpm check && pnpm build
```

Expected: 0 errors, 0 warnings; both bundles build. The built `dist/archive-template/index.html` contains all three script tags.

- [ ] **Step 4: Commit**

```bash
git add archive-template/index.html app/src/archive/ArchiveApp.svelte
git commit -m "feat(archive): bootstrap reads local-image-paths script tag"
```

DO NOT push.

---

## Task 5: Exporter branches HTML vs ZIP

**Files:**
- Modify: `app/src/exporters/html-exporter.ts`
- Modify: `app/src/exporters/html-exporter.test.ts`

The current `exportHtml` always returns one HTML blob. Rename it `exportArchive` (keep `exportHtml` as a re-export alias if needed) and have it branch:

- Zero blobs → existing single-file HTML behavior; injected `local-image-paths` and `image-blobs` are both `{}`. Filename: `saves-archive.html`. MIME: `text/html`.
- Some blobs → build a ZIP via JSZip with `index.html` (containing the inventory + a populated `local-image-paths` map + empty `image-blobs`), `inventory.json`, and `images/<filename>` files. Filename: `saves-archive.zip`. MIME: `application/zip`.

- [ ] **Step 1: Update tests**

Replace the existing `html-exporter.test.ts` content with two distinct test groups (no-blobs HTML path, with-blobs ZIP path). The exact previous test had a single happy-path covering inventory injection; we keep that for the HTML branch and add a ZIP branch test.

```ts
// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

const archiveShell = `<!doctype html>
<html><body>
<script type="application/json" id="inventory">
{"saves":[]}
</script>
<script type="application/json" id="local-image-paths">
{}
</script>
<script type="application/json" id="image-blobs">
{}
</script>
</body></html>`;

beforeEach(async () => {
  const { clearImageBlobs } = await import('../lib/image-store');
  await clearImageBlobs();
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(archiveShell, { status: 200 })));
});

describe('exportArchive — HTML branch (no saved blobs)', () => {
  it('returns a single .html file with the inventory injected and empty path/blob maps', async () => {
    const { exportArchive } = await import('./html-exporter');
    const inv = { saves: [{ uri: 'a', author: { did: 'd', handle: 'h' }, record: { text: 't', createdAt: '2026-05-05T00:00:00Z' } }] };
    const r = await exportArchive(inv as any);
    expect(r.filename).toBe('saves-archive.html');
    expect(r.blob.type).toBe('text/html');
    const text = await r.blob.text();
    const inv1 = /<script type="application\/json" id="inventory">([\s\S]*?)<\/script>/.exec(text);
    expect(inv1).not.toBeNull();
    expect(JSON.parse(inv1![1]).saves[0].uri).toBe('a');
    const lp = /<script type="application\/json" id="local-image-paths">([\s\S]*?)<\/script>/.exec(text);
    expect(JSON.parse(lp![1])).toEqual({});
    const ib = /<script type="application\/json" id="image-blobs">([\s\S]*?)<\/script>/.exec(text);
    expect(JSON.parse(ib![1])).toEqual({});
  });
});

describe('exportArchive — ZIP branch (saved blobs)', () => {
  it('returns a .zip with index.html, inventory.json, and images/<sha>.<ext>', async () => {
    const { saveImageBlob } = await import('../lib/image-store');
    await saveImageBlob('https://i/1', new Blob(['png-bytes'], { type: 'image/png' }));
    const { exportArchive } = await import('./html-exporter');
    const inv = { saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }] };
    const r = await exportArchive(inv as any);
    expect(r.filename).toBe('saves-archive.zip');
    expect(r.blob.type).toBe('application/zip');

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());
    expect(zip.file('index.html')).not.toBeNull();
    expect(zip.file('inventory.json')).not.toBeNull();
    const imageFiles = Object.keys(zip.files).filter((f) => f.startsWith('images/') && !zip.files[f].dir);
    expect(imageFiles.length).toBe(1);
    expect(imageFiles[0]).toMatch(/^images\/[0-9a-f]{64}\.png$/);

    const indexHtml = await zip.file('index.html')!.async('string');
    const lp = /<script type="application\/json" id="local-image-paths">([\s\S]*?)<\/script>/.exec(indexHtml);
    expect(lp).not.toBeNull();
    const map = JSON.parse(lp![1]);
    expect(map['https://i/1']).toBe(imageFiles[0]);
    const ib = /<script type="application\/json" id="image-blobs">([\s\S]*?)<\/script>/.exec(indexHtml);
    expect(JSON.parse(ib![1])).toEqual({});

    const invText = await zip.file('inventory.json')!.async('string');
    expect(JSON.parse(invText).saves[0].uri).toBe('a');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run app/src/exporters/html-exporter.test.ts
```

Expected: failure — `exportArchive` not exported, ZIP behavior missing.

- [ ] **Step 3: Update `app/src/exporters/html-exporter.ts`**

Replace the contents with:

```ts
import JSZip from 'jszip';
import type { Inventory } from '../reader/inventory-shape';
import { gatherImageFiles, type GatheredImageFile } from '../lib/gather-image-files';

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

const ARCHIVE_URL = '/archive-template/index.html';
const INVENTORY_RE = /(<script type="application\/json" id="inventory">)[\s\S]*?(<\/script>)/;
const LOCAL_PATHS_RE = /(<script type="application\/json" id="local-image-paths">)[\s\S]*?(<\/script>)/;
const IMAGE_BLOBS_RE = /(<script type="application\/json" id="image-blobs">)[\s\S]*?(<\/script>)/;

function escapeForScript(json: string): string {
  return json.replace(/<\/script/gi, '<\\/script');
}

function injectScript(re: RegExp, html: string, payload: unknown, label: string): string {
  if (!re.test(html)) {
    throw new Error(`Archive shell missing ${label} script tag`);
  }
  const json = escapeForScript(JSON.stringify(payload));
  return html.replace(re, (_match, openTag, closeTag) => `${openTag}\n${json}\n${closeTag}`);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

function localPathsMap(files: readonly GatheredImageFile[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) out[f.url] = `images/${f.filename}`;
  return out;
}

/**
 * Build either a single-file HTML archive (when no image blobs are saved) or
 * a ZIP archive containing a lean HTML shell plus `inventory.json` plus an
 * `images/` directory (when blobs exist). The HTML's image-resolver registers
 * the appropriate script tag at load time so images render in either form.
 */
export async function exportArchive(inventory: Inventory): Promise<ExportResult> {
  const shell = await fetchText(ARCHIVE_URL);
  const files = await gatherImageFiles(inventory);

  if (files.length === 0) {
    let html = shell;
    html = injectScript(INVENTORY_RE, html, inventory, 'inventory');
    html = injectScript(LOCAL_PATHS_RE, html, {}, 'local-image-paths');
    html = injectScript(IMAGE_BLOBS_RE, html, {}, 'image-blobs');
    return { blob: new Blob([html], { type: 'text/html' }), filename: 'saves-archive.html' };
  }

  let html = shell;
  html = injectScript(INVENTORY_RE, html, inventory, 'inventory');
  html = injectScript(LOCAL_PATHS_RE, html, localPathsMap(files), 'local-image-paths');
  html = injectScript(IMAGE_BLOBS_RE, html, {}, 'image-blobs');

  const zip = new JSZip();
  zip.file('index.html', html);
  zip.file('inventory.json', JSON.stringify(inventory));
  const imagesDir = zip.folder('images')!;
  for (const f of files) {
    imagesDir.file(f.filename, f.blob);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  return { blob: zipBlob, filename: 'saves-archive.zip' };
}

// Backwards-compatible export name; kept as an alias for any in-flight callers
// while ExportMenu migrates to the new name.
export { exportArchive as exportHtml };
```

- [ ] **Step 4: Update `app/src/components/ExportMenu.svelte`**

Find the import:

```svelte
  import { exportHtml } from '../exporters/html-exporter';
```

Replace with:

```svelte
  import { exportArchive } from '../exporters/html-exporter';
```

Find the call site (likely `await exportHtml(inv)`):

```svelte
      const r = await exportHtml(inv);
```

Replace with:

```svelte
      const r = await exportArchive(inv);
```

If the menu has a label like `Export HTML`, change to `Export archive`. (Search for the existing label string in the file.)

- [ ] **Step 5: Run check + tests + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 errors, 0 warnings; all tests pass; both bundles build.

- [ ] **Step 6: Commit**

```bash
git add app/src/exporters/html-exporter.ts app/src/exporters/html-exporter.test.ts app/src/components/ExportMenu.svelte
git commit -m "feat(exporter): ZIP archive when blobs exist; HTML when not"
```

DO NOT push.

---

## Final verification

- [ ] **Step 1: Full matrix**

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

- `mimeToExt` covers common image MIME types and falls back to `bin`.
- `gatherImageFiles` returns deterministic SHA-256 hex filenames; skips URLs without saved blobs; sorts by URL.
- Image resolver consults: local-image-paths → embedded-blobs → IDB → remote, in that order.
- Archive shell has all three script tags; `ArchiveApp.svelte` registers both maps on mount.
- `exportArchive` returns a `text/html` blob with `.html` filename when no blobs exist, an `application/zip` blob with `.zip` filename otherwise.
- ZIP contains `index.html`, `inventory.json`, and `images/<sha>.<ext>` files.
- The `exportHtml` alias is preserved so any in-flight callers keep working.
- Five commits, in order.
- `pnpm check && pnpm test && pnpm build` clean.
