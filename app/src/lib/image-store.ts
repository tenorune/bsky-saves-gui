// IndexedDB-backed store for hydrated image blobs. Keyed by remote URL so
// render-time lookups are a direct get(url). Lives in its own object store so
// Settings → "Clear all local data" can drop it without touching the inventory.

import { createStore, get, set, del, clear, keys } from 'idb-keyval';

const store = createStore('bsky-saves:images', 'blobs');

export async function saveImageBlob(url: string, blob: Blob): Promise<void> {
  await set(url, blob, store);
}

export async function loadImageBlob(url: string): Promise<Blob | undefined> {
  return get<Blob>(url, store);
}

export async function hasImageBlob(url: string): Promise<boolean> {
  return (await get(url, store)) !== undefined;
}

export async function imageBlobCount(): Promise<number> {
  return (await keys(store)).length;
}

export async function deleteImageBlob(url: string): Promise<void> {
  await del(url, store);
}

export async function clearImageBlobs(): Promise<void> {
  await clear(store);
}

/**
 * Given a set of image URLs, return the subset that already have a blob in IDB.
 * Used by PostFocus to render per-post backup status.
 */
export async function getSavedImageUrls(
  urls: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all(
    urls.map(async (url) => {
      if (await hasImageBlob(url)) out.add(url);
    }),
  );
  return out;
}
