// IndexedDB-backed store for hydrated image blobs. Keyed by remote URL so
// render-time lookups are a direct get(url). Lives in its own object store so
// Settings → "Clear all local data" can drop it without touching the inventory.
//
// In session-only mode (signInDraft.saveInventory === false), writes go to
// an in-memory map instead of IDB, and reads consult the map first. The
// "Save Library to this device" flow flushes the map to IDB.
//
// IDB representation:
//   v1 (legacy): the raw Blob, stored directly. Reads still accept this.
//   v2: { buffer: ArrayBuffer, type: string }. iOS Safari has a long-
//   standing bug where storing a Blob in IDB rejects with a null
//   IDBRequest.error for certain Blobs (notably those constructed from
//   ArrayBuffers with non-image MIME types). Storing the ArrayBuffer
//   directly and reconstructing the Blob on read sidesteps the quirk
//   on all platforms with no behavior change for working ones.

import { createStore, get, set, del, clear, keys } from 'idb-keyval';
import { writable, type Readable } from 'svelte/store';
import { shouldPersistLibraryData } from './persistence-mode';

const store = createStore('bsky-saves:images', 'blobs');

// USER-SPECIFIC. In-memory cache of decoded image Blobs keyed by remote
// URL — used by the session-only mode path (signInDraft.saveInventory
// === false) so the Library can render images without the IDB round-trip
// that would commit them to disk. Cleared by clearImageBlobs() at every
// identity-change boundary: Settings → Clear data, and SignIn.submit
// when starting a session-only sign-in. Survives sign-out alone (same
// user signs back in). See issue #19 for the singleton-audit catalogue.
const inMemoryBlobs = new Map<string, Blob>();

interface BlobRecord {
  readonly buffer: ArrayBuffer;
  readonly type: string;
}

function isBlobRecord(v: unknown): v is BlobRecord {
  if (!v || typeof v !== 'object') return false;
  if (v instanceof Blob) return false;
  // Duck-typed: real ArrayBuffer instanceof check fails after some
  // IDB-implementation round-trips (notably fake-indexeddb across
  // realms). buffer present + type string is enough to dispatch.
  const r = v as { buffer?: unknown; type?: unknown };
  return r.buffer !== undefined && typeof r.type === 'string';
}

async function blobToRecord(blob: Blob): Promise<BlobRecord> {
  return { buffer: await blob.arrayBuffer(), type: blob.type };
}

function recordToBlob(rec: BlobRecord): Blob {
  // Blob constructor accepts ArrayBuffer, ArrayBufferView, or Blob in
  // the parts array — covers the worst-case where rec.buffer was
  // round-tripped as a typed-array view instead of a raw ArrayBuffer.
  return new Blob([rec.buffer as BlobPart], { type: rec.type });
}

// Reactive count of saved image blobs (sum of IDB + in-memory map).
// Subscribers (e.g., ExportMenu's HTML / HTML Archive label) get
// updates whenever a blob is added, removed, or the store is cleared,
// so they don't need to poll or wait for an unrelated reactive
// dependency to fire.
const blobCountStore = writable<number>(0);
export const savedImageBlobCount: Readable<number> = {
  subscribe: blobCountStore.subscribe,
};

async function refreshBlobCount(): Promise<void> {
  try {
    const onDisk = (await keys(store)).length;
    blobCountStore.set(onDisk + inMemoryBlobs.size);
  } catch {
    // Leave the prior value in place rather than zeroing on a transient
    // IDB error — the next mutation will retry the refresh.
  }
}

// Initialize at module load so callers see a real count without waiting
// for a mutation. Fire-and-forget — the writable starts at 0 and lifts
// to the true value as soon as the IDB read resolves.
void refreshBlobCount();

export async function saveImageBlob(url: string, blob: Blob): Promise<void> {
  if (shouldPersistLibraryData()) {
    await set(url, await blobToRecord(blob), store);
    inMemoryBlobs.delete(url);
  } else {
    inMemoryBlobs.set(url, blob);
  }
  void refreshBlobCount();
}

export async function loadImageBlob(url: string): Promise<Blob | undefined> {
  const m = inMemoryBlobs.get(url);
  if (m !== undefined) return m;
  const v = await get<Blob | BlobRecord>(url, store);
  if (v === undefined) return undefined;
  if (v instanceof Blob) return v; // legacy v1 entries
  if (isBlobRecord(v)) return recordToBlob(v);
  return undefined;
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
  void refreshBlobCount();
}

export async function clearImageBlobs(): Promise<void> {
  inMemoryBlobs.clear();
  await clear(store);
  blobCountStore.set(0);
}

/**
 * Flush in-memory blobs to IDB. Called by the "Save Library to this
 * device" button so the user's session-only image hydration is preserved
 * when they decide to opt into persistence mid-session.
 */
export async function persistInMemoryImageBlobs(): Promise<void> {
  if (inMemoryBlobs.size === 0) return;
  for (const [url, blob] of inMemoryBlobs) {
    await set(url, await blobToRecord(blob), store);
  }
  inMemoryBlobs.clear();
  // Total count is unchanged — blobs just moved from one backing to
  // the other — but refresh defensively in case the IDB write counts
  // diverge from expectations.
  void refreshBlobCount();
}

/** For tests only — drop the in-memory map and reset the count store. */
export function _resetImageStoreForTests(): void {
  inMemoryBlobs.clear();
  blobCountStore.set(0);
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
