// Synchronous "has the user saved an inventory in this browser?" flag.
// Two backings, OR'd together:
//   - localStorage (persist mode): survives reload AND browser quit.
//   - sessionStorage (session-only mode): survives reload, gone on quit.
// Either being set means the Library is reachable in this session.
//
// The navbar's Library link gates on this so its correct value is on the
// very first paint — no flash from the async IDB read in inventoryState.
//
// Set by saveInventory() in inventory-store.ts (chooses the right store
// based on persistence mode). Cleared by clearInventory() (Settings →
// Reset) and by the persist-flush path (saveLibraryToDevice promotes
// session → persist).

import { writable, type Readable } from 'svelte/store';
import { shouldPersistLibraryData } from './persistence-mode';
import { expireStaleSessionData } from './session-heartbeat';

const LOCAL_KEY = 'inventory-present:v1';
const SESSION_KEY = 'inventory-present:v1';

function readSync(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(LOCAL_KEY) === '1') {
      return true;
    }
  } catch { /* ignore */ }
  // Expire any stale sessionStorage data first so a session-restored
  // presence flag from a previous browser run doesn't make the navbar
  // claim there's a Library when there isn't.
  expireStaleSessionData();
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_KEY) === '1') {
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

const store = writable<boolean>(readSync());
export const inventoryPresent: Readable<boolean> = { subscribe: store.subscribe };

export function markInventoryPresent(): void {
  store.set(true);
  // Route the persistent flag to whichever store matches the user's
  // intent: localStorage for "Keep my saves" persist mode (survives
  // browser quit), sessionStorage for session-only (gone on quit).
  const persist = shouldPersistLibraryData();
  try {
    if (persist) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LOCAL_KEY, '1');
    } else {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SESSION_KEY, '1');
    }
  } catch {
    // Quota or disabled storage — the in-memory store still reflects
    // the truth for this tab; we just lose the cross-reload signal.
  }
}

export function clearInventoryPresent(): void {
  store.set(false);
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/**
 * Promote the session-only flag to the persist (localStorage) flag.
 * Called by saveLibraryToDevice() when the user opts into persistence
 * mid-session — without this, the persistent flag would be in
 * sessionStorage only and a browser quit would still drop it.
 */
export function promoteToPersistedPresence(): void {
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(LOCAL_KEY, '1'); } catch { /* ignore */ }
  store.set(true);
}
