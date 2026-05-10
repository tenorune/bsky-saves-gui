// IndexedDB-backed store for hydrated image blobs. Keyed by remote URL so
// render-time lookups are a direct get(url). Lives in its own object store so
// Settings → "Clear all local data" can drop it without touching the inventory.
//
// In session-only mode (signInDraft.saveInventory === false), writes go to
// an in-memory map instead of IDB, and reads consult the map first. The
// "Save Library to this device" flow flushes the map to IDB.

import { createStore, get, set, del, clear, keys } from 'idb-keyval';
import { shouldPersistLibraryData } from './persistence-mode';

const store = createStore('bsky-saves:images', 'blobs');
const inMemoryBlobs = new Map<string, Blob>();

export async function saveImageBlob(url: string, blob: Blob): Promise<void> {
  if (shouldPersistLibraryData()) {
    await set(url, blob, store);
    inMemoryBlobs.delete(url);
    return;
  }
  inMemoryBlobs.set(url, blob);
}

export async function loadImageBlob(url: string): Promise<Blob | undefined> {
  const m = inMemoryBlobs.get(url);
  if (m !== undefined) return m;
  return get<Blob>(url, store);
}

export async function hasImageBlob(url: string): Promise<boolean> {
  if (inMemoryBlobs.has(url)) return true;
  return (await get(url, store)) !== undefined;
}

export async function imageBlobCount(): Promise<number> {
  // Prefer disk count when in persist mode (session-only callers
  // generally don't need this metric). When the in-memory map is non-
  // empty, add its size to the disk count for an accurate total.
  const onDisk = (await keys(store)).length;
  return onDisk + inMemoryBlobs.size;
}

export async function deleteImageBlob(url: string): Promise<void> {
  inMemoryBlobs.delete(url);
  await del(url, store);
}

export async function clearImageBlobs(): Promise<void> {
  inMemoryBlobs.clear();
  await clear(store);
}

/**
 * Flush in-memory blobs to IDB. Called by the "Save Library to this
 * device" button so the user's session-only image hydration is preserved
 * when they decide to opt into persistence mid-session.
 */
export async function persistInMemoryImageBlobs(): Promise<void> {
  if (inMemoryBlobs.size === 0) return;
  for (const [url, blob] of inMemoryBlobs) {
    await set(url, blob, store);
  }
  inMemoryBlobs.clear();
}

/** For tests only — drop the in-memory map. */
export function _resetImageStoreForTests(): void {
  inMemoryBlobs.clear();
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
