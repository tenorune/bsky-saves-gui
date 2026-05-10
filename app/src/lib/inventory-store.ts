import { get, set, del } from 'idb-keyval';
import { markInventoryPresent, clearInventoryPresent } from './inventory-presence';
import { shouldPersistLibraryData } from './persistence-mode';

const KEY = 'inventory:v1';

export type Inventory = unknown; // shape comes from bsky-saves; treated opaquely here

// In-memory fallback used when the user signed in with "Keep my saves in
// this browser" unchecked. Reads/writes hit this map first; nothing
// touches IDB. Cleared on clearInventory() and on persistInMemoryToDisk()
// (the "Save Library to this device" button).
let inMemoryInventory: Inventory | null = null;

export async function saveInventory(inventory: Inventory): Promise<void> {
  if (shouldPersistLibraryData()) {
    await set(KEY, inventory);
    markInventoryPresent();
    inMemoryInventory = null;
    return;
  }
  inMemoryInventory = inventory;
}

export async function loadInventory(): Promise<Inventory | null> {
  // In-memory wins when session-only mode is active so the running session
  // sees its own writes. When the user later flips to persist (via "Save
  // Library to this device"), persistInMemoryToDisk() flushes the map and
  // resets it; from that point on, IDB is the source of truth.
  if (inMemoryInventory !== null) return inMemoryInventory;
  const v = await get(KEY);
  return v === undefined ? null : v;
}

export async function clearInventory(): Promise<void> {
  inMemoryInventory = null;
  await del(KEY);
  clearInventoryPresent();
}

/**
 * Force the in-memory inventory to disk and switch the store back to
 * disk-backed mode. Called by Settings' "Save Library to this device"
 * button when the user wants to persist a session-only session.
 *
 * No-op if there's nothing in memory (the user is already disk-backed).
 */
export async function persistInMemoryToDisk(): Promise<void> {
  if (inMemoryInventory === null) return;
  await set(KEY, inMemoryInventory);
  markInventoryPresent();
  inMemoryInventory = null;
}

/** For tests only — drop the in-memory fallback. */
export function _resetInventoryStoreForTests(): void {
  inMemoryInventory = null;
}
