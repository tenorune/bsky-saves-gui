// "Should I keep library data on disk?" — single source of truth read by
// every persistence call site (inventory, image blobs, lastSession). The
// answer comes from the SignIn form's "Keep my saves in this browser"
// checkbox, surfaced via signInDraft.saveInventory.
//
// Rule:
//   - draft set + saveInventory: true   → persist (default behavior)
//   - draft set + saveInventory: false  → session-only mode
//   - no draft (returning visit, no fresh sign-in this session)
//                                       → persist (principle of least
//                                         surprise: only an explicit
//                                         unchecked choice flips the mode)
//
// Reactive consumers subscribe to `persistenceMode` (derived store).
// Imperative writes inside store modules call shouldPersistLibraryData()
// at write time so the gate applies at the moment of the I/O.

import { derived, get, type Readable } from 'svelte/store';
import { signInDraft } from './sign-in-draft';

export type PersistenceMode = 'persist' | 'session-only';

export function shouldPersistLibraryData(): boolean {
  const draft = get(signInDraft);
  if (draft === null) return true;
  return draft.saveInventory !== false;
}

export const persistenceMode: Readable<PersistenceMode> = derived(
  signInDraft,
  ($draft) => ($draft && $draft.saveInventory === false ? 'session-only' : 'persist'),
);
