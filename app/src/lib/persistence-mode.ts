// "Should I keep library data on disk?" — single source of truth read by
// every persistence call site (inventory, image blobs, lastSession). The
// answer comes from two places, OR'd together:
//
//   1. A sessionStorage marker (`session-only-mode:v1`) written at sign-in
//      when the user UNCHECKED "Keep my saves in this browser." The marker
//      survives in-tab refresh (sessionStorage is per-tab and persists
//      across reload), so every page-load gate sees the user's intent
//      without needing the in-memory draft.
//
//   2. The in-memory signInDraft.saveInventory boolean. Used to populate
//      (1) at sign-in time and as the inferred answer during the small
//      window before the marker is written.
//
// Rule:
//   - marker set                       → session-only
//   - marker unset, draft saveInv:false → session-only (transient pre-mark)
//   - marker unset, draft saveInv:true  → persist
//   - marker unset, no draft           → persist (default for returning
//                                          visits with no fresh sign-in)
//
// Reactive consumers subscribe to `persistenceMode` (derived store).
// Imperative writes inside store modules call shouldPersistLibraryData()
// at write time so the gate applies at the moment of the I/O.

import { derived, get, writable, type Readable } from 'svelte/store';
import { signInDraft } from './sign-in-draft';

export type PersistenceMode = 'persist' | 'session-only';

const MARKER_KEY = 'session-only-mode:v1';

function readMarker(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(MARKER_KEY) === '1';
  } catch {
    return false;
  }
}

const sessionOnlyMarker = writable<boolean>(readMarker());

export function markSessionOnly(): void {
  sessionOnlyMarker.set(true);
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem(MARKER_KEY, '1'); } catch { /* best-effort */ }
}

export function clearSessionOnlyMarker(): void {
  sessionOnlyMarker.set(false);
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.removeItem(MARKER_KEY); } catch { /* best-effort */ }
}

export function shouldPersistLibraryData(): boolean {
  if (get(sessionOnlyMarker)) return false;
  const draft = get(signInDraft);
  if (draft === null) return true;
  return draft.saveInventory !== false;
}

export const persistenceMode: Readable<PersistenceMode> = derived(
  [signInDraft, sessionOnlyMarker],
  ([$draft, $marker]) => {
    if ($marker) return 'session-only';
    if ($draft && $draft.saveInventory === false) return 'session-only';
    return 'persist';
  },
);
