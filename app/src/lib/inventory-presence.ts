// Synchronous "has the user ever saved an inventory in this browser" flag,
// backed by localStorage so it survives page reload. The in-memory
// `inventoryState` store starts as 'loading' on every cold start and only
// flips to 'ready' after the async IndexedDB read finishes — gating
// navigation chrome (the Library link) on that store causes a visible
// flash on reload where the link disappears until the load completes.
// This flag is the persistent shape of the same predicate: "is there an
// inventory cached locally?"
//
// Set when saveInventory() runs (any time the helper or fetch path writes
// the inventory to IndexedDB). Cleared when clearInventory() runs (Reset
// in Settings). Read synchronously at module load so the navbar's
// reactive block has the right value on the very first paint.

import { writable, type Readable } from 'svelte/store';

const STORAGE_KEY = 'inventory-present:v1';

function readSync(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const store = writable<boolean>(readSync());
export const inventoryPresent: Readable<boolean> = { subscribe: store.subscribe };

export function markInventoryPresent(): void {
  store.set(true);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Quota or disabled storage — the in-memory store still reflects
    // the truth for this tab; we just lose the cross-reload signal.
  }
}

export function clearInventoryPresent(): void {
  store.set(false);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above — best-effort.
  }
}
