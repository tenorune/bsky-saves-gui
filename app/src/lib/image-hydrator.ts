// Walks an inventory, fetches every image URL it can find, and stores the
// bytes as Blobs in image-store. Mutates the inventory: each save whose images
// are (now) hydrated gets `local_images: [{url}]` so downstream consumers
// (ExportMenu's heuristic, JSON exports, the bsky-saves CLI) can tell.

import { hasImageBlob, saveImageBlob } from './image-store';

interface MutableSave {
  images?: Array<{ url?: unknown }>;
  quoted_post?: unknown;
  thread_replies?: Array<{ images?: Array<{ url?: unknown }> }>;
  local_images?: Array<{ url: string }>;
}

interface MutableInventory {
  saves?: MutableSave[];
}

function collectFromImageArray(arr: unknown, out: Set<string>): void {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const url = (item as Record<string, unknown>).url;
      if (typeof url === 'string' && /^https?:\/\//.test(url)) out.add(url);
    }
  }
}

function collectFromQuoted(q: unknown, out: Set<string>): void {
  if (!q || typeof q !== 'object') return;
  const o = q as Record<string, unknown>;
  collectFromImageArray(o.images, out);
  // Quoted posts may also carry an embed.images shape; cover it for symmetry
  // with the renderer.
  const embed = o.embed;
  if (embed && typeof embed === 'object') {
    const eImgs = (embed as Record<string, unknown>).images;
    if (Array.isArray(eImgs)) {
      for (const item of eImgs) {
        if (item && typeof item === 'object') {
          const r = item as Record<string, unknown>;
          const url = r.fullsize ?? r.thumb ?? r.url;
          if (typeof url === 'string' && /^https?:\/\//.test(url)) out.add(url);
        }
      }
    }
  }
}

export function extractImageUrls(inventory: unknown): string[] {
  const out = new Set<string>();
  if (!inventory || typeof inventory !== 'object') return [];
  const inv = inventory as MutableInventory;
  if (!Array.isArray(inv.saves)) return [];
  for (const save of inv.saves) {
    collectFromImageArray(save.images, out);
    collectFromQuoted(save.quoted_post, out);
    if (Array.isArray(save.thread_replies)) {
      for (const reply of save.thread_replies) {
        collectFromImageArray(reply.images, out);
      }
    }
  }
  return [...out];
}

async function fetchOne(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

interface HydrateOptions {
  readonly concurrency?: number;
  readonly onLog?: (msg: string) => void;
}

export interface HydrateResult {
  readonly fetched: number;
  readonly skipped: number;
  readonly failed: number;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function pump(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

/**
 * Fetches every image URL in the inventory that isn't already cached, stores
 * blobs in image-store, and tags each save whose images are now (or were
 * already) hydrated with `local_images: [{url}]`. Returns the SAME inventory
 * object after mutation, plus a count summary.
 */
export async function hydrateImages(
  inventory: unknown,
  options: HydrateOptions = {},
): Promise<{ inventory: unknown; result: HydrateResult }> {
  const log = options.onLog ?? (() => {});
  const concurrency = options.concurrency ?? 6;

  const allUrls = extractImageUrls(inventory);
  if (allUrls.length === 0) {
    return { inventory, result: { fetched: 0, skipped: 0, failed: 0 } };
  }

  log(`Hydrating images: ${allUrls.length} unique URLs.`);

  // Skip any URL already in the blob store so re-runs are cheap.
  const todo: string[] = [];
  let skipped = 0;
  for (const url of allUrls) {
    if (await hasImageBlob(url)) skipped++;
    else todo.push(url);
  }
  if (skipped > 0) log(`${skipped} already cached.`);

  let fetched = 0;
  let failed = 0;
  const failedUrls = new Set<string>();
  await runWithConcurrency(todo, concurrency, async (url) => {
    try {
      const blob = await fetchOne(url);
      await saveImageBlob(url, blob);
      fetched++;
    } catch (e) {
      failed++;
      failedUrls.add(url);
      log(`image failed: ${url} (${e instanceof Error ? e.message : String(e)})`);
    }
  });

  log(`Hydrated ${fetched} image${fetched === 1 ? '' : 's'}, ${failed} failed.`);

  // Mark each save that has any image whose blob is now cached.
  if (inventory && typeof inventory === 'object') {
    const inv = inventory as MutableInventory;
    if (Array.isArray(inv.saves)) {
      for (const save of inv.saves) {
        const urls = new Set<string>();
        const buf = new Set<string>();
        collectFromImageArray(save.images, buf);
        collectFromQuoted(save.quoted_post, buf);
        if (Array.isArray(save.thread_replies)) {
          for (const reply of save.thread_replies) {
            collectFromImageArray(reply.images, buf);
          }
        }
        for (const u of buf) {
          if (!failedUrls.has(u)) urls.add(u);
        }
        if (urls.size > 0) {
          save.local_images = [...urls].map((url) => ({ url }));
        }
      }
    }
  }

  return { inventory, result: { fetched, skipped, failed } };
}
