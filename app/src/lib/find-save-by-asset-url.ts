import type { Save } from '../reader/inventory-shape';

function imageArrayContains(arr: unknown, url: string): boolean {
  if (!Array.isArray(arr)) return false;
  for (const img of arr) {
    if (!img || typeof img !== 'object') continue;
    const u = (img as Record<string, unknown>).url;
    if (u === url) return true;
  }
  return false;
}

function repliesArrayContains(arr: unknown, url: string): boolean {
  if (!Array.isArray(arr)) return false;
  for (const reply of arr) {
    if (!reply || typeof reply !== 'object') continue;
    if (imageArrayContains((reply as Record<string, unknown>).images, url)) return true;
  }
  return false;
}

function saveContains(save: unknown, url: string): boolean {
  if (!save || typeof save !== 'object') return false;
  const s = save as Record<string, unknown>;

  if (imageArrayContains(s.images, url)) return true;
  if (repliesArrayContains(s.thread_replies, url)) return true;

  const embed = s.embed;
  if (embed && typeof embed === 'object') {
    const e = embed as Record<string, unknown>;
    if (e.url === url) return true;
    if (imageArrayContains(e.images, url)) return true;
  }

  const quoted = s.quoted_post;
  if (quoted && typeof quoted === 'object') {
    const q = quoted as Record<string, unknown>;
    if (imageArrayContains(q.images, url)) return true;
    if (repliesArrayContains(q.thread_replies, url)) return true;
  }

  return false;
}

/**
 * Walk an inventory's saves and return the first save whose asset URLs
 * include the given URL. Searches the same locations as
 * `extract-image-urls.ts` and `extract-article-urls.ts`.
 *
 * Returns null on no match, missing inventory, or malformed shapes.
 */
export function findSaveByAssetUrl(
  inventory: unknown,
  url: string,
): Save | null {
  if (!inventory || typeof inventory !== 'object') return null;
  const inv = inventory as { saves?: unknown };
  if (!Array.isArray(inv.saves)) return null;
  for (const save of inv.saves) {
    if (saveContains(save, url)) return save as Save;
  }
  return null;
}
