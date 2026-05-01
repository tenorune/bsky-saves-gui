# Plan 4 — Exporters and Archive Build

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three exporters — JSON, Markdown, HTML archive — accessible from an Export menu in the app header. The HTML archive is a self-contained mini-app that reuses Plan 3's reader components, with the inventory inlined as a `<script type="application/json">` blob. Two export modes per format where applicable: "Bundle as zip" vs "Self-contained."

**Architecture:** Three pure exporter modules (`json-exporter.ts`, `markdown-exporter.ts`, `html-exporter.ts`) under `app/src/exporters/`. A `archive-template/` entry point becomes a second Vite build target that produces a static reader-only bundle. The HTML exporter, at export time, fetches that bundle and injects the user's inventory.

**Tech Stack:** Existing Svelte/Vite/TS. Adds `jszip` for zip packaging. Vite multi-page build for the archive template.

**Image handling (scope note):** Plan 2 fetches and enriches but does not hydrate images. Until Plan 7 adds image persistence, exports reference image URLs as they appear in the inventory (typically `cdn.bsky.app` URLs). When `local_images` is empty (the current case), exporters use the embed view URLs. When `local_images` is later populated, the HTML exporter's "self-contained" mode will fetch those bytes from IndexedDB and inline as data URIs — but that wiring is deferred.

**Reference:** [Design spec](../specs/2026-05-01-bsky-saves-gui-design.md) — Output formats, Components → exporters.

---

## File Structure

```
app/src/
├── exporters/
│   ├── zip.ts                         # JSZip wrapper
│   ├── file-download.ts               # browser file-save helper
│   ├── file-download.test.ts
│   ├── json-exporter.ts
│   ├── json-exporter.test.ts
│   ├── markdown-exporter.ts
│   ├── markdown-exporter.test.ts
│   ├── html-exporter.ts
│   └── html-exporter.test.ts
├── archive/                           # archive-template Svelte entry (separate Vite input)
│   ├── ArchiveApp.svelte              # mounts reader from inline JSON
│   └── main.ts
├── components/
│   ├── ExportMenu.svelte              # header menu
│   └── ExportMenu.test.ts             # interaction smoke
└── App.svelte                         # modified: add ExportMenu to header

archive-template/
└── index.html                         # second Vite entry; uses /src/archive/main.ts
```

The archive template's HTML bootstraps `app/src/archive/main.ts`. Vite builds both `index.html` (live app) and `archive-template/index.html` (archive shell) into `dist/`.

---

## Task 1: JSZip dependency and zip wrapper

**Files:**
- Modify: `package.json` (add `jszip`)
- Create: `app/src/exporters/zip.ts`

- [ ] **Step 1: Install**

```bash
pnpm add jszip
```

- [ ] **Step 2: Implement `app/src/exporters/zip.ts`**

```ts
import JSZip from 'jszip';

export interface ZipEntry {
  readonly path: string;
  readonly content: string | Uint8Array | Blob;
}

export async function buildZip(entries: readonly ZipEntry[]): Promise<Blob> {
  const zip = new JSZip();
  for (const entry of entries) {
    if (entry.content instanceof Blob) {
      zip.file(entry.path, entry.content);
    } else {
      zip.file(entry.path, entry.content);
    }
  }
  return zip.generateAsync({ type: 'blob' });
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml app/src/exporters/zip.ts
git commit -m "feat(exporters): JSZip wrapper for archive packaging"
```

---

## Task 2: file-download helper

**Files:**
- Create: `app/src/exporters/file-download.ts`
- Create: `app/src/exporters/file-download.test.ts`

- [ ] **Step 1: Test**

```ts
// app/src/exporters/file-download.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('downloadFile', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates an anchor with download attribute and clicks it', async () => {
    const { downloadFile } = await import('./file-download');
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const clicked = vi.fn();

    // Spy on anchor click
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        el.click = clicked;
      }
      return el;
    });

    downloadFile(blob, 'export.txt');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
```

- [ ] **Step 2: Implement `app/src/exporters/file-download.ts`**

```ts
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Run, expect pass.**

- [ ] **Step 4: Commit**

```bash
git add app/src/exporters/file-download.ts app/src/exporters/file-download.test.ts
git commit -m "feat(exporters): browser file-download helper"
```

---

## Task 3: JSON exporter

**Files:**
- Create: `app/src/exporters/json-exporter.ts`
- Create: `app/src/exporters/json-exporter.test.ts`

- [ ] **Step 1: Test**

```ts
// app/src/exporters/json-exporter.test.ts
import { describe, expect, it } from 'vitest';
import type { Inventory } from '../reader/inventory-shape';

const sample: Inventory = {
  saves: [
    {
      uri: 'at://x/y/1',
      cid: 'c',
      author: { did: 'd', handle: 'h.example' },
      record: { text: 'hi', createdAt: '2026-04-01T00:00:00Z' },
      indexedAt: '2026-04-01T00:00:00Z',
    },
  ],
};

describe('jsonExporter', () => {
  it('returns a Blob with the inventory JSON', async () => {
    const { exportJson } = await import('./json-exporter');
    const result = await exportJson(sample);
    expect(result.filename).toBe('saves_inventory.json');
    expect(result.blob.type).toBe('application/json');
    const text = await result.blob.text();
    expect(JSON.parse(text)).toEqual(sample);
  });

  it('formats with two-space indentation', async () => {
    const { exportJson } = await import('./json-exporter');
    const result = await exportJson(sample);
    const text = await result.blob.text();
    expect(text).toContain('\n  "saves"');
  });
});
```

- [ ] **Step 2: Implement `app/src/exporters/json-exporter.ts`**

```ts
import type { Inventory } from '../reader/inventory-shape';

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

export async function exportJson(inventory: Inventory): Promise<ExportResult> {
  const text = JSON.stringify(inventory, null, 2);
  return {
    blob: new Blob([text], { type: 'application/json' }),
    filename: 'saves_inventory.json',
  };
}
```

- [ ] **Step 3: Run, expect pass.** Commit.

```bash
git add app/src/exporters/json-exporter.ts app/src/exporters/json-exporter.test.ts
git commit -m "feat(exporters): JSON exporter"
```

---

## Task 4: Markdown exporter

**Files:**
- Create: `app/src/exporters/markdown-exporter.ts`
- Create: `app/src/exporters/markdown-exporter.test.ts`

- [ ] **Step 1: Test**

```ts
// app/src/exporters/markdown-exporter.test.ts
import { describe, expect, it } from 'vitest';
import type { Inventory } from '../reader/inventory-shape';

const sample: Inventory = {
  saves: [
    {
      uri: 'at://did:plc:abc/app.bsky.feed.post/3l00',
      cid: 'c',
      author: { did: 'd', handle: 'alice.bsky.social', displayName: 'Alice' },
      record: { text: 'first post', createdAt: '2026-04-01T12:00:00Z' },
      indexedAt: '2026-04-01T12:00:00Z',
    },
    {
      uri: 'at://did:plc:abc/app.bsky.feed.post/3l01',
      cid: 'c',
      author: { did: 'd', handle: 'bob.example' },
      record: { text: 'second post', createdAt: '2026-05-01T12:00:00Z' },
      indexedAt: '2026-05-01T12:00:00Z',
    },
  ],
};

describe('markdownExporter', () => {
  it('emits a flat reverse-chronological document with frontmatter', async () => {
    const { exportMarkdown } = await import('./markdown-exporter');
    const result = await exportMarkdown(sample, {
      account: 'me.bsky.social',
      hydratedFlags: { enrich: true, threads: false, articles: false, images: false },
    });
    const md = await result.blob.text();
    expect(result.filename).toBe('saves.md');
    // Frontmatter
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('account: me.bsky.social');
    expect(md).toContain('count: 2');
    expect(md).toContain('enrich: true');
    // Reverse-chronological order: bob (2026-05) before alice (2026-04)
    const bobIdx = md.indexOf('bob.example');
    const aliceIdx = md.indexOf('alice.bsky.social');
    expect(bobIdx).toBeGreaterThan(0);
    expect(aliceIdx).toBeGreaterThan(bobIdx);
    // Each save has a heading with date and handle
    expect(md).toContain('## 2026-05-01 · @bob.example');
    expect(md).toContain('## 2026-04-01 · @alice.bsky.social');
    // Original-post link
    expect(md).toContain('https://bsky.app/profile/');
  });

  it('inlines hydrated article text under a Linked article subhead', async () => {
    const { exportMarkdown } = await import('./markdown-exporter');
    const inv: Inventory = {
      saves: [
        {
          uri: 'at://x/y/3l',
          cid: 'c',
          author: { did: 'd', handle: 'h.example' },
          record: { text: 'check this', createdAt: '2026-04-01T00:00:00Z' },
          indexedAt: '2026-04-01T00:00:00Z',
          article: {
            url: 'https://example.com/post',
            title: 'A great post',
            text: 'Body of the linked article.',
          },
        },
      ],
    };
    const result = await exportMarkdown(inv, {
      account: 'me',
      hydratedFlags: { enrich: false, threads: false, articles: true, images: false },
    });
    const md = await result.blob.text();
    expect(md).toContain('### Linked article: A great post');
    expect(md).toContain('Body of the linked article.');
  });
});
```

- [ ] **Step 2: Implement `app/src/exporters/markdown-exporter.ts`**

```ts
import type { Inventory, Save } from '../reader/inventory-shape';
import { sortByCreatedDesc } from '../reader/feed-filter';

export interface HydratedFlags {
  readonly enrich: boolean;
  readonly threads: boolean;
  readonly articles: boolean;
  readonly images: boolean;
}

export interface MarkdownExportOptions {
  readonly account: string;
  readonly hydratedFlags: HydratedFlags;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

function bskyUrl(save: Save): string {
  const m = /\/([^/]+)$/.exec(save.uri);
  const rkey = m?.[1] ?? '';
  return `https://bsky.app/profile/${encodeURIComponent(save.author.handle)}/post/${encodeURIComponent(rkey)}`;
}

function imageUrls(save: Save): string[] {
  const e = save.embed as { images?: { fullsize?: string; thumb?: string }[] } | undefined;
  if (!Array.isArray(e?.images)) return [];
  return e!.images
    .map((img) => img.fullsize ?? img.thumb)
    .filter((u): u is string => typeof u === 'string');
}

function renderSave(save: Save): string {
  const date = save.record.createdAt.slice(0, 10);
  const lines: string[] = [`## ${date} · @${save.author.handle}`, ''];
  if (save.author.displayName) lines.push(`*${save.author.displayName}*`, '');
  lines.push(save.record.text, '');
  lines.push(`[Original post](${bskyUrl(save)})`, '');
  for (const url of imageUrls(save)) {
    lines.push(`![](${url})`);
  }
  if (save.article) {
    lines.push('', `### Linked article${save.article.title ? `: ${save.article.title}` : ''}`, '');
    lines.push(save.article.text);
  }
  if (save.thread && save.thread.length > 0) {
    lines.push('', '### Thread', '');
    for (const entry of save.thread) {
      lines.push(`> @${entry.author.handle}: ${entry.record.text}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export async function exportMarkdown(
  inventory: Inventory,
  options: MarkdownExportOptions,
): Promise<ExportResult> {
  const sorted = sortByCreatedDesc(inventory.saves);
  const frontmatter = [
    '---',
    `exported_at: ${new Date().toISOString()}`,
    `account: ${options.account}`,
    `count: ${sorted.length}`,
    'hydrated:',
    `  enrich: ${options.hydratedFlags.enrich}`,
    `  threads: ${options.hydratedFlags.threads}`,
    `  articles: ${options.hydratedFlags.articles}`,
    `  images: ${options.hydratedFlags.images}`,
    '---',
    '',
  ].join('\n');

  const body = sorted.map(renderSave).join('\n');
  const text = frontmatter + body;

  return {
    blob: new Blob([text], { type: 'text/markdown' }),
    filename: 'saves.md',
  };
}
```

- [ ] **Step 3: Run, expect pass.** Commit.

```bash
git add app/src/exporters/markdown-exporter.ts app/src/exporters/markdown-exporter.test.ts
git commit -m "feat(exporters): Markdown exporter with frontmatter and reverse-chrono ordering"
```

---

## Task 5: Archive template entry — Svelte app that reads inline inventory

**Files:**
- Create: `archive-template/index.html`
- Create: `app/src/archive/ArchiveApp.svelte`
- Create: `app/src/archive/main.ts`

The archive's HTML uses a separate Vite input. Its app reads the inventory from an inline `<script type="application/json" id="inventory">` and renders the same `LibraryView`/`PostFocus` components as the live app.

- [ ] **Step 1: Create `archive-template/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>%VITE_APP_NAME% — Archive</title>
  </head>
  <body>
    <div id="archive"></div>
    <script type="application/json" id="inventory">
      {"saves":[]}
    </script>
    <script type="module" src="/src/archive/main.ts"></script>
  </body>
</html>
```

The placeholder JSON `{"saves":[]}` is the empty default; the html-exporter (Task 7) replaces this script tag's content.

NOTE: The path `archive-template/index.html` is at the repo root, NOT under `app/`. This means Vite's existing `root: 'app'` setting won't find it. Task 6 adjusts the build config to include this second input.

- [ ] **Step 2: Create `app/src/archive/main.ts`**

```ts
import ArchiveApp from './ArchiveApp.svelte';

const target = document.getElementById('archive');
if (!target) {
  throw new Error('Missing #archive mount target');
}

new ArchiveApp({ target });
```

- [ ] **Step 3: Create `app/src/archive/ArchiveApp.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { writable, type Readable } from 'svelte/store';
  import { parseInventory, rkeyOf, type Inventory, type Save } from '../reader/inventory-shape';
  import LibraryView from '../reader/LibraryView.svelte';
  import PostFocus from '../reader/PostFocus.svelte';

  type View =
    | { name: 'loading' }
    | { name: 'error'; message: string }
    | { name: 'library'; inventory: Inventory }
    | { name: 'post'; inventory: Inventory; save: Save };

  const view = writable<View>({ name: 'loading' });
  let inventory: Inventory | null = null;

  function readInline(): Inventory {
    const el = document.getElementById('inventory');
    if (!el) throw new Error('No inline inventory script');
    return parseInventory(JSON.parse(el.textContent ?? '{}'));
  }

  function applyHash(): void {
    if (!inventory) return;
    const hash = window.location.hash;
    const m = /^#\/post\/(.+)$/.exec(hash);
    if (m) {
      const rkey = decodeURIComponent(m[1]);
      const save = inventory.saves.find((s) => rkeyOf(s.uri) === rkey);
      if (save) {
        view.set({ name: 'post', inventory, save });
        return;
      }
    }
    view.set({ name: 'library', inventory });
  }

  onMount(() => {
    try {
      inventory = readInline();
      applyHash();
      const handler = () => applyHash();
      window.addEventListener('hashchange', handler);
      return () => window.removeEventListener('hashchange', handler);
    } catch (e) {
      view.set({ name: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });

  function open(save: Save): void {
    window.location.hash = `#/post/${rkeyOf(save.uri)}`;
  }
</script>

<main class="archive">
  {#if $view.name === 'loading'}
    <p>Loading…</p>
  {:else if $view.name === 'error'}
    <p class="error">Failed to load: {$view.message}</p>
  {:else if $view.name === 'library'}
    <LibraryView inventory={$view.inventory} onSelectPost={open} />
  {:else if $view.name === 'post'}
    <header><a href="#/library">← Library</a></header>
    <PostFocus save={$view.save} />
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .archive {
    max-width: 50rem;
    margin: 0 auto;
    padding: 1.5rem;
  }
  .error {
    color: red;
  }
</style>
```

- [ ] **Step 4: Commit**

```bash
git add archive-template/index.html app/src/archive/main.ts app/src/archive/ArchiveApp.svelte
git commit -m "feat(archive): archive-template entry that mounts reader from inline JSON"
```

---

## Task 6: Multi-page Vite build

The Vite config currently has `root: 'app'`. To produce `dist/index.html` (live app) AND `dist/archive-template/index.html` (archive shell), use `rollupOptions.input` with absolute paths and adjust `root` accordingly.

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: Update `vite.config.ts`**

The key change: move `root` back to the project root and set explicit `rollupOptions.input` for both entries. Update aliases and envDir as needed.

Replace `vite.config.ts` contents with:

```ts
import { defineConfig, loadEnv } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { cnamePlugin } from './tools/vite-plugin-cname';

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, projectRoot, 'VITE_');
  const domain = env.VITE_APP_DOMAIN ?? '';

  return {
    root: projectRoot,
    publicDir: resolve(projectRoot, 'app/public'),
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve(projectRoot, 'app/index.html'),
          archive: resolve(projectRoot, 'archive-template/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        $lib: resolve(projectRoot, 'app/src/lib'),
        $routes: resolve(projectRoot, 'app/src/routes'),
      },
    },
    plugins: [svelte({ preprocess: vitePreprocess() }), cnamePlugin({ domain })],
  };
});
```

- [ ] **Step 2: Verify both entries build**

```bash
rm -rf dist
pnpm build
```

Expected: `dist/index.html` (live app shell from `app/index.html`) and `dist/archive-template/index.html` both present.

If the build complains about `app/index.html`'s script src `/src/main.ts`, change that path to `/app/src/main.ts`. Same for `archive-template/index.html`'s `/src/archive/main.ts` → `/app/src/archive/main.ts`. Vite resolves relative to `root`, which is now the project root.

- [ ] **Step 3: Update `app/index.html` if needed**

If the script src needs adjusting from `/src/main.ts` to `/app/src/main.ts`, do it. Same for `archive-template/index.html` (`/src/archive/main.ts` → `/app/src/archive/main.ts`).

- [ ] **Step 4: Re-run pnpm dev to verify the live app still works**

```bash
pnpm dev
```

Open the URL. The live app should still work.

- [ ] **Step 5: Re-run pnpm test**

```bash
pnpm test
```

The vitest config inherits the vite config — verify no test regressions.

If `vitest.config.ts`'s call to `viteConfigFactory({ mode: 'test', command: 'build', isSsrBuild: false })` returns config with multiple inputs that confuses vitest, the fix is to override `build.rollupOptions` to a single dummy entry in the vitest config. Try without first.

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts app/index.html archive-template/index.html
git commit -m "build: multi-page Vite input for live app + archive template"
```

(Stage `app/index.html` and `archive-template/index.html` only if they actually changed.)

---

## Task 7: HTML exporter

Fetches the built archive shell (`/archive-template/`), injects the user's inventory, and emits either a multi-file zip or a self-contained single HTML.

**Files:**
- Create: `app/src/exporters/html-exporter.ts`
- Create: `app/src/exporters/html-exporter.test.ts`

- [ ] **Step 1: Test**

```ts
// app/src/exporters/html-exporter.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Inventory } from '../reader/inventory-shape';

const inv: Inventory = {
  saves: [
    {
      uri: 'at://x/y/1',
      cid: 'c',
      author: { did: 'd', handle: 'h.example' },
      record: { text: 't', createdAt: '2026-04-01T00:00:00Z' },
      indexedAt: '2026-04-01T00:00:00Z',
    },
  ],
};

const archiveHtml = `<!doctype html>
<html><head><title>Archive</title>
<script type="module" crossorigin src="/archive-template/assets/archive-abc.js"></script>
<link rel="stylesheet" crossorigin href="/archive-template/assets/archive-def.css">
</head><body>
<div id="archive"></div>
<script type="application/json" id="inventory">
{"saves":[]}
</script>
</body></html>`;

const archiveJs = 'console.log("archive js");';
const archiveCss = '.archive{}';

describe('htmlExporter', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/archive-template/index.html')) return new Response(archiveHtml);
        if (url.endsWith('/archive-template/assets/archive-abc.js')) return new Response(archiveJs);
        if (url.endsWith('/archive-template/assets/archive-def.css'))
          return new Response(archiveCss);
        return new Response('not found', { status: 404 });
      }),
    );
  });

  it('returns a multi-file zip in zip mode with inventory injected', async () => {
    const { exportHtml } = await import('./html-exporter');
    const result = await exportHtml(inv, { mode: 'zip' });
    expect(result.filename).toBe('saves-archive.zip');
    expect(result.blob.type).toMatch(/zip/);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('returns a single self-contained HTML in self-contained mode', async () => {
    const { exportHtml } = await import('./html-exporter');
    const result = await exportHtml(inv, { mode: 'self-contained' });
    expect(result.filename).toBe('saves-archive.html');
    expect(result.blob.type).toBe('text/html');
    const text = await result.blob.text();
    // Inventory present
    expect(text).toContain('"h.example"');
    // JS inlined
    expect(text).toContain('console.log("archive js")');
    // CSS inlined
    expect(text).toContain('.archive{}');
    // No external script/link references remain
    expect(text).not.toMatch(/<script[^>]*src=/);
    expect(text).not.toMatch(/<link[^>]*href=/);
  });
});
```

- [ ] **Step 2: Implement `app/src/exporters/html-exporter.ts`**

```ts
import type { Inventory } from '../reader/inventory-shape';
import { buildZip, type ZipEntry } from './zip';

export interface HtmlExportOptions {
  readonly mode: 'zip' | 'self-contained';
}

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

const ARCHIVE_BASE = '/archive-template/';
const INVENTORY_RE = /(<script type="application\/json" id="inventory">)[\s\S]*?(<\/script>)/;

function injectInventory(html: string, inventory: Inventory): string {
  const json = JSON.stringify(inventory).replace(/<\/script/gi, '<\\/script');
  if (!INVENTORY_RE.test(html)) {
    throw new Error('Archive shell missing inventory script tag');
  }
  return html.replace(INVENTORY_RE, `$1\n${json}\n$2`);
}

interface ExtractedAssets {
  readonly scriptSrcs: readonly string[];
  readonly cssHrefs: readonly string[];
  readonly htmlWithoutAssets: string;
}

const SCRIPT_SRC_RE = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi;
const CSS_LINK_RE = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*\/?>/gi;

function extractAssets(html: string): ExtractedAssets {
  const scriptSrcs: string[] = [];
  const cssHrefs: string[] = [];
  let stripped = html.replace(SCRIPT_SRC_RE, (_match, src) => {
    if (typeof src === 'string' && src.length > 0) scriptSrcs.push(src);
    return '';
  });
  stripped = stripped.replace(CSS_LINK_RE, (_match, href) => {
    if (typeof href === 'string' && href.length > 0) cssHrefs.push(href);
    return '';
  });
  return { scriptSrcs, cssHrefs, htmlWithoutAssets: stripped };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

export async function exportHtml(
  inventory: Inventory,
  options: HtmlExportOptions,
): Promise<ExportResult> {
  const shell = await fetchText(`${ARCHIVE_BASE}index.html`);
  const withInventory = injectInventory(shell, inventory);

  if (options.mode === 'zip') {
    const { scriptSrcs, cssHrefs } = extractAssets(withInventory);
    const entries: ZipEntry[] = [{ path: 'index.html', content: withInventory }];
    for (const src of scriptSrcs) {
      const path = src.replace(/^\/archive-template\//, '');
      entries.push({ path, content: await fetchText(src) });
    }
    for (const href of cssHrefs) {
      const path = href.replace(/^\/archive-template\//, '');
      entries.push({ path, content: await fetchText(href) });
    }
    const blob = await buildZip(entries);
    return { blob, filename: 'saves-archive.zip' };
  }

  // Self-contained: inline JS and CSS into the HTML.
  const { scriptSrcs, cssHrefs, htmlWithoutAssets } = extractAssets(withInventory);
  const inlinedScripts = await Promise.all(
    scriptSrcs.map(async (src) => `<script type="module">${await fetchText(src)}</script>`),
  );
  const inlinedStyles = await Promise.all(
    cssHrefs.map(async (href) => `<style>${await fetchText(href)}</style>`),
  );
  const finalHtml = htmlWithoutAssets.replace(
    '</head>',
    `${inlinedStyles.join('\n')}\n${inlinedScripts.join('\n')}\n</head>`,
  );
  return {
    blob: new Blob([finalHtml], { type: 'text/html' }),
    filename: 'saves-archive.html',
  };
}
```

- [ ] **Step 3: Run, expect pass.**

- [ ] **Step 4: Commit**

```bash
git add app/src/exporters/html-exporter.ts app/src/exporters/html-exporter.test.ts
git commit -m "feat(exporters): HTML archive exporter with zip and self-contained modes"
```

---

## Task 8: ExportMenu component and header wiring

**Files:**
- Create: `app/src/components/ExportMenu.svelte`
- Modify: `app/src/App.svelte` (add ExportMenu to header)

- [ ] **Step 1: Create `app/src/components/ExportMenu.svelte`**

```svelte
<script lang="ts">
  import { get } from 'svelte/store';
  import { inventoryState } from '$lib/inventory-loader';
  import { exportJson } from '../exporters/json-exporter';
  import { exportMarkdown } from '../exporters/markdown-exporter';
  import { exportHtml } from '../exporters/html-exporter';
  import { downloadFile } from '../exporters/file-download';

  let busy = false;
  let error = '';
  let htmlMode: 'zip' | 'self-contained' = 'self-contained';

  async function withInventory(fn: (inv: import('../reader/inventory-shape').Inventory) => Promise<void>) {
    error = '';
    const s = get(inventoryState);
    if (s.status !== 'ready') {
      error = 'No inventory loaded.';
      return;
    }
    busy = true;
    try {
      await fn(s.inventory);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function handleJson() {
    return withInventory(async (inv) => {
      const r = await exportJson(inv);
      downloadFile(r.blob, r.filename);
    });
  }

  function handleMarkdown() {
    return withInventory(async (inv) => {
      const r = await exportMarkdown(inv, {
        account: 'unknown',
        hydratedFlags: { enrich: true, threads: false, articles: false, images: false },
      });
      downloadFile(r.blob, r.filename);
    });
  }

  function handleHtml() {
    return withInventory(async (inv) => {
      const r = await exportHtml(inv, { mode: htmlMode });
      downloadFile(r.blob, r.filename);
    });
  }
</script>

<details class="export-menu">
  <summary>Export</summary>
  <div class="export-menu__panel">
    <button type="button" disabled={busy} on:click={handleJson}>JSON</button>
    <button type="button" disabled={busy} on:click={handleMarkdown}>Markdown</button>
    <div class="export-menu__html">
      <button type="button" disabled={busy} on:click={handleHtml}>HTML</button>
      <label>
        <input type="radio" bind:group={htmlMode} value="self-contained" />
        Self-contained
      </label>
      <label>
        <input type="radio" bind:group={htmlMode} value="zip" />
        Bundle as zip
      </label>
    </div>
    {#if error}
      <p class="export-menu__error" role="alert">{error}</p>
    {/if}
  </div>
</details>

<style>
  .export-menu {
    position: relative;
  }
  .export-menu summary {
    cursor: pointer;
    padding: 0.25rem 0.5rem;
  }
  .export-menu__panel {
    position: absolute;
    right: 0;
    top: 100%;
    background: Canvas;
    border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
    border-radius: 6px;
    padding: 0.75rem;
    min-width: 14rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .export-menu__panel button {
    font: inherit;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
  }
  .export-menu__html {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    padding-top: 0.5rem;
  }
  .export-menu__html label {
    font-size: 0.875rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .export-menu__error {
    margin: 0;
    color: color-mix(in oklab, red 70%, CanvasText);
    font-size: 0.875rem;
  }
</style>
```

- [ ] **Step 2: Add ExportMenu to `app/src/App.svelte` header**

In `app/src/App.svelte`, import `ExportMenu` and place it inside `app-header__nav`:

```svelte
<script lang="ts">
  // existing imports...
  import ExportMenu from './components/ExportMenu.svelte';
</script>

<!-- existing markup; modify the nav block: -->
<nav class="app-header__nav">
  <a href="#/library">Library</a>
  <a href="#/settings">Settings</a>
  <a href="#/privacy">Privacy</a>
  <ExportMenu />
</nav>
```

- [ ] **Step 3: Verify**

```bash
pnpm check        # 0 errors
pnpm test         # all tests pass
pnpm build        # success; both index.html and archive-template/index.html in dist
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/ExportMenu.svelte app/src/App.svelte
git commit -m "feat(exporters): ExportMenu in header wired to JSON/Markdown/HTML exporters"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

```bash
pnpm test
```

Expected: ~50 tests across all suites.

- [ ] **Step 2: Build artifacts**

```bash
rm -rf dist
pnpm build
ls dist/
ls dist/archive-template/
```

Expected: `dist/index.html`, `dist/CNAME`, `dist/assets/`, `dist/archive-template/index.html`, `dist/archive-template/assets/`.

- [ ] **Step 3: Manual smoke**

```bash
pnpm preview
```

Open the URL. With or without an inventory:
- The Export menu appears in the header.
- Clicking JSON downloads a file (errors if no inventory).
- Markdown and HTML similarly.

If you have an inventory: open the downloaded HTML in a fresh browser. Verify the archive renders the library and post focus correctly without any backend.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Done criteria

After Plan 4:

1. Three exporters work: JSON, Markdown, HTML.
2. The HTML archive is a self-contained or bundled mini-app that uses the same reader components as the live app.
3. Multi-page Vite build produces both `dist/index.html` and `dist/archive-template/index.html`.
4. ExportMenu in the header invokes exporters and downloads files.
5. All unit tests pass; type check is clean; build is clean.
6. Image bundling deferred — exporters reference image URLs as they appear in the inventory.
