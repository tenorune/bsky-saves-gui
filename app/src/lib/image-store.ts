// IndexedDB-backed store for hydrated image blobs. Keyed by remote URL so
// render-time lookups are a direct get(url). Lives in its own object store so
// `Settings → Clear all local data` can drop it without touching the
// inventory.

import { createStore, get, set, del, clear, keys } from 'idb-keyval';

const store = createStore('bsky-saves:images', 'blobs');

export async function saveImageBlob(url: string, blob: Blob): Promise<void> {
  await set(url, blob, store);
}

export async function loadImageBlob(url: string): Promise<Blob | undefined> {
  const v = await get<Blob>(url, store);
  return v;
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
