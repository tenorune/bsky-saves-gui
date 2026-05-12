/**
 * render-static-archive.ts
 *
 * Produces a pre-rendered static HTML archive from an Inventory. No Svelte
 * runtime, no JS modules, no inventory.json. Pure string concatenation so
 * it works in both Node (tests) and browsers.
 *
 * When no image blobs are available → single self-contained HTML file.
 * When image blobs are saved         → Map of path→content for ZIP assembly.
 */

import type { Inventory, Save } from '../reader/inventory-shape';
import type { GatheredImageFile } from '../lib/gather-image-files';
import { formatAuthor, formatDateTime, formatHandle } from '../reader/format';
import { bskyPostUrl } from '../lib/bsky-permalink';
import { rkeyOf } from '../reader/inventory-shape';

export interface StaticArchiveSingleHtml {
  readonly kind: 'html';
  readonly html: string;
}

export interface StaticArchiveFiles {
  readonly kind: 'files';
  readonly files: ReadonlyMap<string, string>; // path → text content (HTML/CSS)
}

export type StaticArchiveOutput = StaticArchiveSingleHtml | StaticArchiveFiles;

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// alias — identical escaping rules
export const escapeAttr = escapeHtml;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function splitParagraphs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const byBlank = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  return trimmed
    .split(/\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Image path resolution
// ---------------------------------------------------------------------------

/** Build a Map<originalUrl, "images/{sha}.{ext}"> from the gathered files. */
function buildPathMap(imageFiles: readonly GatheredImageFile[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of imageFiles) {
    m.set(f.url, `images/${f.filename}`);
  }
  return m;
}

/**
 * Resolve an image URL to either a local path (ZIP mode) or the original URL
 * (single-file mode / no blob saved). Returns null only when the input is
 * empty/falsy.
 */
export function urlToLocalPath(
  url: string,
  pathMap: ReadonlyMap<string, string>,
): string | null {
  if (!url) return null;
  return pathMap.get(url) ?? null;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

interface ImageRef {
  url: string;
  alt: string;
}

export function renderImages(
  imageRefs: readonly ImageRef[],
  pathMap: ReadonlyMap<string, string>,
  prefix = '',
): string {
  if (imageRefs.length === 0) return '';
  const imgs = imageRefs
    .map((img) => {
      const local = pathMap.get(img.url);
      const src = local ? `${prefix}${local}` : img.url;
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(img.alt)}" loading="lazy">`;
    })
    .join('\n');
  return `<div class="post-body__images">\n${imgs}\n</div>`;
}

function pickString(obj: unknown, ...keys: string[]): string | null {
  if (obj === null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function pickImages(obj: unknown): ImageRef[] {
  if (obj === null || typeof obj !== 'object') return [];
  const o = obj as Record<string, unknown>;
  const out: ImageRef[] = [];

  if (Array.isArray(o.images)) {
    for (const item of o.images as unknown[]) {
      const url = pickString(item, 'url', 'fullsize', 'thumb');
      if (!url) continue;
      const alt = pickString(item, 'alt') ?? '';
      out.push({ url, alt });
    }
    if (out.length > 0) return out;
  }

  const embed = o.embed;
  if (embed && typeof embed === 'object') {
    const eImgs = (embed as Record<string, unknown>).images;
    if (Array.isArray(eImgs)) {
      for (const item of eImgs as unknown[]) {
        const url = pickString(item, 'fullsize', 'thumb', 'url');
        if (!url) continue;
        const alt = pickString(item, 'alt') ?? '';
        out.push({ url, alt });
      }
    }
  }

  const local = o.local_images;
  if (out.length === 0 && Array.isArray(local)) {
    for (const item of local as unknown[]) {
      const url = pickString(item, 'path', 'url');
      if (!url) continue;
      out.push({ url, alt: '' });
    }
  }

  return out;
}

export function renderQuotedPost(
  quote: unknown,
  pathMap: ReadonlyMap<string, string>,
  prefix = '',
): string {
  const text = pickString(quote, 'text', 'post_text') ?? '';
  const createdAt = pickString(quote, 'created_at', 'post_created_at') ?? '';
  const handle = pickString(
    typeof quote === 'object' && quote !== null
      ? (quote as Record<string, unknown>).author
      : null,
    'handle',
  );
  const dateOnly = createdAt.slice(0, 10);
  const images = pickImages(quote);

  if (!text && !handle && images.length === 0) return '';

  const handleHtml = handle
    ? `<span class="quoted-post__handle">@${escapeHtml(handle)}</span>`
    : '';
  const timeHtml =
    dateOnly
      ? `<time class="quoted-post__time" datetime="${escapeAttr(createdAt)}">${escapeHtml(dateOnly)}</time>`
      : '';
  const textHtml = text
    ? `<p class="quoted-post__text">${escapeHtml(text)}</p>`
    : '';
  const imagesHtml = renderImages(images, pathMap, prefix);

  return `<blockquote class="quoted-post">
<header class="quoted-post__header">${handleHtml}${timeHtml}</header>
${textHtml}
${imagesHtml}
</blockquote>`;
}

export function renderArticleDetails(save: Save): string {
  if (!save.article?.text) return '';
  const paras = splitParagraphs(save.article.text)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n');
  return `<details class="post-body__article">
<summary>View backed-up article text</summary>
${paras}
</details>`;
}

export function renderEmbedLink(save: Save): string {
  const e = save.embed as { url?: unknown; title?: unknown } | undefined;
  if (!e) return '';
  if (typeof e.url !== 'string' || !/^https?:\/\//.test(e.url)) return '';
  const title =
    typeof e.title === 'string' && e.title.length > 0 ? e.title : e.url;
  return `<p class="post-body__embed-link"><a href="${escapeAttr(e.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title as string)}</a></p>`;
}

export function renderPostBody(
  save: Save,
  pathMap: ReadonlyMap<string, string>,
  prefix = '',
): string {
  const text = save.record.text;
  const textHtml = text
    ? `<p class="post-body__text">${escapeHtml(text)}</p>`
    : '';

  // Resolve images: prefer local_images if present, then embed.images,
  // then top-level images array (bsky-saves raw shape).
  const localImgs: ImageRef[] = (save.local_images ?? []).map((li) => ({
    url: li.path,
    alt: '',
  }));
  const embedImages = (() => {
    const e = save.embed as { images?: unknown[] } | undefined;
    if (!Array.isArray(e?.images)) return [];
    return (e!.images as Array<{ fullsize?: string; thumb?: string; alt?: string }>)
      .map((img) => ({
        url: img.fullsize ?? img.thumb ?? '',
        alt: img.alt ?? '',
      }))
      .filter((img) => img.url);
  })();
  // bsky-saves raw shape: top-level `images: [{url, alt}]`
  const topLevelImages = (() => {
    const raw = (save as unknown as { images?: unknown[] }).images;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((img) => {
        const i = img as { url?: string; alt?: string };
        return { url: i.url ?? '', alt: i.alt ?? '' };
      })
      .filter((img) => img.url);
  })();

  const imageRefs =
    localImgs.length > 0
      ? localImgs
      : embedImages.length > 0
        ? embedImages
        : topLevelImages;
  const imagesHtml = renderImages(imageRefs, pathMap, prefix);

  const quotedPost = (save as unknown as { quoted_post?: unknown }).quoted_post ?? null;
  const quotedHtml = quotedPost ? renderQuotedPost(quotedPost, pathMap, prefix) : '';

  const embedLinkHtml = renderEmbedLink(save);
  const articleHtml = renderArticleDetails(save);

  return `<div class="post-body">
${textHtml}
${imagesHtml}
${quotedHtml}
${embedLinkHtml}
${articleHtml}
</div>`;
}

export function renderThread(
  thread: Save['thread'],
  pathMap: ReadonlyMap<string, string>,
  prefix = '',
): string {
  if (!thread || thread.length === 0) return '';
  const items = thread
    .map((entry) => {
      const timeHtml = entry.record.createdAt
        ? `<time datetime="${escapeAttr(entry.record.createdAt)}">${escapeHtml(formatDateTime(entry.record.createdAt))}</time>`
        : '';
      const textHtml = entry.record.text
        ? `<p class="post-focus__thread-text">${escapeHtml(entry.record.text)}</p>`
        : '';
      const threadImages: ImageRef[] = (entry.images ?? []).map((img) => ({
        url: img.url,
        alt: img.alt ?? '',
      }));
      const imagesHtml =
        threadImages.length > 0
          ? `<div class="post-focus__thread-images">\n${threadImages.map((img) => {
              const local = pathMap.get(img.url);
              const src = local ? `${prefix}${local}` : img.url;
              return `<img src="${escapeAttr(src)}" alt="${escapeAttr(img.alt)}" loading="lazy">`;
            }).join('\n')}\n</div>`
          : '';
      return `<li><header>${timeHtml}</header>${textHtml}${imagesHtml}</li>`;
    })
    .join('\n');
  return `<section class="post-focus__thread">
<h3>Thread</h3>
<ol>
${items}
</ol>
</section>`;
}

export function renderPostFocusContent(
  save: Save,
  pathMap: ReadonlyMap<string, string>,
  prefix = '',
): string {
  const author = escapeHtml(formatAuthor(save.author));
  const handle = escapeHtml(formatHandle(save.author.handle));
  const dt = save.record.createdAt;
  const timeHtml = `<time class="post-focus__time" datetime="${escapeAttr(dt)}">${escapeHtml(formatDateTime(dt))}</time>`;
  const bskyUrl = bskyPostUrl(save);
  const bodyHtml = renderPostBody(save, pathMap, prefix);
  const threadHtml = renderThread(save.thread, pathMap, prefix);

  return `<article class="post-focus">
<header class="post-focus__header">
<span class="post-focus__author">${author}</span>
<span class="post-focus__handle">${handle}</span>
${timeHtml}
</header>
${bodyHtml}
<p class="post-focus__link"><a href="${escapeAttr(bskyUrl)}" target="_blank" rel="noopener noreferrer">View on bsky.app</a></p>
${threadHtml}
</article>`;
}

export function renderPostCardSummary(
  save: Save,
  _pathMap: ReadonlyMap<string, string>,
  hrefPrefix: string,
): string {
  const rkey = rkeyOf(save.uri);
  const author = formatAuthor(save.author);
  const handle = formatHandle(save.author.handle);
  const dt = save.record.createdAt;
  const text = save.record.text ?? '';

  // data-searchable: lowercased concat of text + author + handle for search widget
  const searchable = escapeAttr(`${text} ${author} ${handle}`.toLowerCase());

  const authorHtml = escapeHtml(author);
  const handleHtml = escapeHtml(handle);
  const timeHtml = `<time class="post-card__time" datetime="${escapeAttr(dt)}">${escapeHtml(formatDateTime(dt))}</time>`;

  // Snippet: first 200 chars of text
  const snippet = text.length > 200 ? text.slice(0, 200) + '…' : text;
  const snippetHtml = `<p class="post-card__snippet">${escapeHtml(snippet)}</p>`;

  const href =
    hrefPrefix === ''
      ? '' // single-file mode: no link (content is inline)
      : `${hrefPrefix}${rkey}.html`;

  const linkHtml =
    href
      ? `<a class="post-card__view-link" href="${escapeAttr(href)}">View post →</a>`
      : '';

  return `<article class="post-card" id="post-${escapeAttr(rkey)}" data-searchable="${searchable}">
<header class="post-card__header">
<span class="post-card__author">${authorHtml}</span>
<span class="post-card__handle">${handleHtml}</span>
${timeHtml}
</header>
${snippetHtml}
${linkHtml}
</article>`;
}

// ---------------------------------------------------------------------------
// Search widget
// ---------------------------------------------------------------------------

const SEARCH_WIDGET = `<input id="search" type="search" placeholder="Search saves…" class="search-input">
<script>
  document.getElementById('search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('[data-searchable]').forEach((el) => {
      el.hidden = q && !el.dataset.searchable.includes(q);
    });
  });
<\/script>`;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const STYLES = `
/* === Reset & base === */
*, *::before, *::after { box-sizing: border-box; }
html { color-scheme: light dark; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 1rem;
  line-height: 1.5;
  background: Canvas;
  color: CanvasText;
}
a { color: inherit; }
img { display: block; max-width: 100%; }

/* === Layout === */
.archive-header {
  padding: 1.5rem 1.5rem 0.5rem;
  border-bottom: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  margin-bottom: 1.5rem;
}
.archive-header h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}
.archive-header p { margin: 0; opacity: 0.7; font-size: 0.9rem; }
.archive-main { padding: 0 1.5rem 3rem; max-width: 48rem; margin: 0 auto; }

/* === Search === */
.search-input {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  font: inherit;
  font-size: 1rem;
  border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
  border-radius: 6px;
  background: Canvas;
  color: CanvasText;
  margin-bottom: 1.25rem;
}
.search-input:focus { outline: 2px solid color-mix(in oklab, CanvasText 40%, Canvas); outline-offset: 1px; }

/* === Post card (index) === */
.post-card {
  border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 0.75rem;
}
.post-card__header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}
.post-card__author { font-weight: 600; }
.post-card__handle { opacity: 0.7; }
.post-card__time { margin-left: auto; opacity: 0.7; font-variant-numeric: tabular-nums; }
.post-card__snippet { margin: 0 0 0.5rem; white-space: pre-wrap; word-wrap: break-word; }
.post-card__view-link {
  display: inline-block;
  font-size: 0.875rem;
  text-decoration: none;
  opacity: 0.75;
}
.post-card__view-link:hover { opacity: 1; text-decoration: underline; }

/* === Post focus (detail page) === */
.post-focus {
  border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  border-radius: 8px;
  padding: 1rem;
  max-width: 44rem;
  margin: 0 auto;
}
.post-focus__header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}
.post-focus__author { font-weight: 600; }
.post-focus__handle { opacity: 0.7; }
.post-focus__time { margin-left: auto; opacity: 0.7; font-variant-numeric: tabular-nums; }
.post-focus__link { margin-top: 1rem; font-size: 0.9em; }
.post-focus__thread {
  margin-top: 1.5rem;
  border-top: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  padding-top: 1rem;
}
.post-focus__thread h3 {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}
.post-focus__thread ol { list-style: none; padding: 0; margin: 0; }
.post-focus__thread li {
  border-left: 3px solid color-mix(in oklab, CanvasText 15%, transparent);
  padding: 0.5rem 0 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
}
.post-focus__thread header { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; font-size: 0.875rem; }
.post-focus__thread time { margin-left: auto; opacity: 0.7; }
.post-focus__thread-text { margin: 0.25rem 0 0; white-space: pre-wrap; }
.post-focus__thread-images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.post-focus__thread-images img { width: 100%; border-radius: 6px; object-fit: cover; }

/* === Post body === */
.post-body__text { margin: 0; white-space: pre-wrap; word-wrap: break-word; }
.post-body__images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.post-body__images img { width: 100%; border-radius: 6px; object-fit: cover; }
.post-body__embed-link { margin-top: 0.5rem; font-size: 0.9rem; }
.post-body__embed-link a { color: inherit; text-decoration: underline; word-break: break-word; opacity: 0.85; }
.post-body__embed-link a:hover { opacity: 1; }
.post-body__article {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: color-mix(in oklab, CanvasText 5%, Canvas);
  border-radius: 6px;
  font-size: 0.9em;
}
.post-body__article summary { cursor: pointer; font-weight: 500; }
.post-body__article p { margin: 0.5rem 0 0; white-space: pre-wrap; }
.post-body__article p + p { margin-top: 0.85rem; }

/* === Quoted post === */
.quoted-post {
  margin: 0.75rem 0 0;
  padding: 0.75rem;
  border: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, CanvasText 4%, Canvas);
  font-size: 0.95em;
}
.quoted-post__header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  font-size: 0.875rem;
  margin-bottom: 0.4rem;
}
.quoted-post__handle { font-weight: 500; opacity: 0.8; }
.quoted-post__time { margin-left: auto; opacity: 0.65; font-variant-numeric: tabular-nums; }
.quoted-post__text { margin: 0; white-space: pre-wrap; word-wrap: break-word; }
.quoted-post__images {
  margin-top: 0.5rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.4rem;
}
.quoted-post__images img { width: 100%; border-radius: 4px; object-fit: cover; }

/* === Post page nav === */
.post-page-back {
  display: inline-block;
  margin-bottom: 1rem;
  opacity: 0.8;
  text-decoration: none;
  font-size: 0.9rem;
}
.post-page-back:hover { opacity: 1; text-decoration: underline; }
`;

// ---------------------------------------------------------------------------
// Full page builders
// ---------------------------------------------------------------------------

function htmlHead(
  title: string,
  styleContent: string | null,
  stylesheetHref: string | null,
): string {
  const styleTag =
    styleContent != null
      ? `<style>\n${styleContent}\n</style>`
      : stylesheetHref != null
        ? `<link rel="stylesheet" href="${escapeAttr(stylesheetHref)}">`
        : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
${styleTag}
</head>`;
}

export function renderIndex(
  saves: readonly Save[],
  pathMap: ReadonlyMap<string, string>,
  mode: 'single' | 'multi',
): string {
  const title = 'Bluesky Saves Archive';
  const count = saves.length;
  const hrefPrefix = mode === 'multi' ? 'posts/' : '';

  // In single-file mode include full post detail wrapped in a
  // data-searchable container; in multi-file mode just the summary
  // card (which links to the per-post page).
  const cardsHtml = saves
    .map((save) => {
      if (mode === 'single') {
        const rkey = rkeyOf(save.uri);
        const text = save.record.text ?? '';
        const author = formatAuthor(save.author);
        const handle = formatHandle(save.author.handle);
        const searchable = escapeAttr(`${text} ${author} ${handle}`.toLowerCase());
        const detail = renderPostFocusContent(save, pathMap, '');
        return `<div class="post-card__detail" id="post-${escapeAttr(rkey)}" data-searchable="${searchable}">\n${detail}\n</div>`;
      }
      return renderPostCardSummary(save, pathMap, hrefPrefix);
    })
    .join('\n');

  const headHtml =
    mode === 'single'
      ? htmlHead(title, STYLES, null)
      : htmlHead(title, null, 'styles.css');

  return `${headHtml}
<body>
<header class="archive-header">
<h1>${escapeHtml(title)}</h1>
<p>${count} saved post${count === 1 ? '' : 's'}</p>
</header>
<main class="archive-main">
${SEARCH_WIDGET}
${cardsHtml}
</main>
</body>
</html>`;
}

export function renderPostPage(
  save: Save,
  pathMap: ReadonlyMap<string, string>,
): string {
  const author = formatAuthor(save.author);
  const title = `${author} — Bluesky Saves Archive`;
  // posts/ pages are one level deep: styles.css and images/ are at ../
  const detail = renderPostFocusContent(save, pathMap, '../');

  const headHtml = htmlHead(title, null, '../styles.css');

  return `${headHtml}
<body>
<main class="archive-main">
<a class="post-page-back" href="../index.html">← Back to library</a>
${detail}
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function renderStaticArchive(input: {
  inventory: Inventory;
  imageFiles: readonly GatheredImageFile[];
}): StaticArchiveOutput {
  const { inventory, imageFiles } = input;
  const pathMap = buildPathMap(imageFiles);

  if (imageFiles.length === 0) {
    // Single self-contained HTML
    const html = renderIndex(inventory.saves, pathMap, 'single');
    return { kind: 'html', html };
  }

  // Multi-file mode: index + per-post pages + stylesheet
  const files = new Map<string, string>();
  files.set('index.html', renderIndex(inventory.saves, pathMap, 'multi'));
  files.set('styles.css', STYLES);
  for (const save of inventory.saves) {
    let rkey: string;
    try {
      rkey = rkeyOf(save.uri);
    } catch {
      continue; // skip malformed URIs
    }
    files.set(`posts/${rkey}.html`, renderPostPage(save, pathMap));
  }

  return { kind: 'files', files };
}
