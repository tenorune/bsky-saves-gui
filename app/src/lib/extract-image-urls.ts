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
