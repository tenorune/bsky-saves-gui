import { writable, type Readable } from 'svelte/store';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

// v0.6.0 retain-flag — which lifecycle entries the inventory keeps when a
// refresh reconciles it against the fresh fetch:
//   - 'sync'      — mirror Bluesky: drop entries the user un-saved AND
//                   prune dead-subject (deleted / blocked) entries.
//   - 'keep-lost' — drop entries the user un-saved; keep dead-subject
//                   entries (those were lost outside the user's control).
//                   DEFAULT.
//   - 'keep-all'  — retain everything; absent entries just get flagged.
// See docs/v0.6.0-retain-flag-gui-implementation-plan.md.
export type RetainMode = 'sync' | 'keep-lost' | 'keep-all';

const KEY = 'retain-mode:v1';
const DEFAULT: RetainMode = 'keep-lost';

const store = writable<RetainMode>(DEFAULT);
export const retainMode: Readable<RetainMode> = { subscribe: store.subscribe };

function isRetainMode(v: unknown): v is RetainMode {
  return v === 'sync' || v === 'keep-lost' || v === 'keep-all';
}

// Retention breadth: keep-all (widest) > keep-lost > sync (narrowest).
const RETAIN_RANK: Record<RetainMode, number> = { 'keep-all': 2, 'keep-lost': 1, sync: 0 };

/**
 * True when changing from `from` to `to` moves toward a *narrower*
 * retention mode — i.e. the change will delete inventory entries the
 * current mode keeps. Same-mode and widening changes return false.
 *
 * Shared behavioural logic: the mode selector (Settings) confirms
 * narrowing changes, and Task B's reconcile-in-place acts on them.
 */
export function isRetainNarrowing(from: RetainMode, to: RetainMode): boolean {
  return RETAIN_RANK[to] < RETAIN_RANK[from];
}

export async function loadRetainMode(): Promise<void> {
  const raw = await idbGet(KEY);
  store.set(isRetainMode(raw) ? raw : DEFAULT);
}

export async function setRetainMode(mode: RetainMode): Promise<void> {
  store.set(mode);
  await idbSet(KEY, mode);
}

/**
 * Drop the persisted mode so it reverts to the default ('keep-lost').
 *
 * The retain mode is a per-device preference, not user data — so per the
 * asset-toggles / install-hint precedent it is wired into Settings →
 * "Reset preferences" (`clearAllPreferences`), NOT Settings → "Clear
 * data" (`clearAll`). That wiring lands in Task D (the Settings UI);
 * this module just provides the function.
 */
export async function clearRetainMode(): Promise<void> {
  store.set(DEFAULT);
  await idbDel(KEY);
}

/** For tests only — resets to the default without touching IndexedDB. */
export function _resetRetainModeForTests(): void {
  store.set(DEFAULT);
}
