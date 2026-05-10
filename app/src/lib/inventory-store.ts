import { get, set, del } from 'idb-keyval';
import { markInventoryPresent, clearInventoryPresent } from './inventory-presence';
import { shouldPersistLibraryData } from './persistence-mode';

const KEY = 'inventory:v1';
const SESSION_KEY = 'inventory:session-v1';

export type Inventory = unknown; // shape comes from bsky-saves; treated opaquely here

// Session-only mode (signInDraft.saveInventory === false) stores the
// inventory in sessionStorage, NOT IDB. sessionStorage survives in-tab
// page refreshes and SPA navigations, so the Library remains usable
// during the session, but a normal browser-quit clears it (matching the
// user's "don't keep this on my device" intent). Writes that exceed the
// ~5MB sessionStorage quota silently fail; the UI surfaces this through
// the next loadInventory() returning null.

function writeSessionInventory(inventory: Inventory): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(inventory));
    return true;
  } catch {
    return false;
  }
}

function readSessionInventory(): Inventory | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as Inventory;
  } catch {
    return null;
  }
}

function clearSessionInventory(): void {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* best-effort */ }
}

export async function saveInventory(inventory: Inventory): Promise<void> {
  if (shouldPersistLibraryData()) {
    await set(KEY, inventory);
    markInventoryPresent();
    // Persist mode wins — ensure no session-only stragglers from a
    // previous mode flip remain.
    clearSessionInventory();
    return;
  }
  writeSessionInventory(inventory);
  // Mark presence in session-scoped storage so the navbar's Library link
  // stays visible across in-tab refresh.
  markInventoryPresent();
}

export async function loadInventory(): Promise<Inventory | null> {
  // sessionStorage path is sync and tiny — check it first so a
  // session-only sign-in's data is found before we go to IDB. When
  // present in both (a brief overlap during persistInMemoryToDisk),
  // sessionStorage is the freshest write so it wins.
  const fromSession = readSessionInventory();
  if (fromSession !== null) return fromSession;
  const v = await get(KEY);
  return v === undefined ? null : v;
}

export async function clearInventory(): Promise<void> {
  clearSessionInventory();
  await del(KEY);
  clearInventoryPresent();
}

/**
 * Force the session-only inventory to disk and switch the store back to
 * disk-backed mode. Called by Settings' "Save Library to this device"
 * button when the user wants to persist a session-only session.
 *
 * No-op if there's nothing in sessionStorage (the user is already
 * disk-backed).
 */
export async function persistInMemoryToDisk(): Promise<void> {
  const fromSession = readSessionInventory();
  if (fromSession === null) return;
  await set(KEY, fromSession);
  markInventoryPresent();
  clearSessionInventory();
}

/** For tests only — drop sessionStorage state. */
export function _resetInventoryStoreForTests(): void {
  clearSessionInventory();
}
