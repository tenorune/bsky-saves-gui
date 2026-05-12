// Wires navigator.storage.persist() into the persist-mode flow.
//
// Goal: when the user is in persist mode (the default), ask the browser to
// protect IndexedDB from eviction under storage pressure. Without this, the
// Library can be wiped by the browser's heuristic GC without warning.
//
// We call .persist() at most once per page load, the first time the
// persistenceMode store resolves to 'persist'. Subsequent flips (e.g. user
// switches to session-only and back) don't re-call; the permission state is
// page-scoped and the browser has already given us a stable answer.

import type { Readable } from 'svelte/store';
import { persistenceMode as defaultMode, type PersistenceMode } from './persistence-mode';

let _called = false;

export interface InitDeps {
  readonly persistenceMode?: Readable<PersistenceMode>;
}

export function initStoragePersist(deps: InitDeps = {}): void {
  const mode = deps.persistenceMode ?? defaultMode;
  mode.subscribe((m) => {
    if (_called) return;
    if (m !== 'persist') return;
    const storage = (navigator as unknown as { storage?: StorageManager }).storage;
    if (!storage || typeof storage.persist !== 'function') return;
    _called = true;
    storage.persist().catch(() => { /* denied / unsupported — best-effort */ });
  });
}

/** For tests only — resets the once-per-page guard. */
export function _resetForTests(): void {
  _called = false;
}
