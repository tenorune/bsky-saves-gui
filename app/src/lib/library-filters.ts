// Module-level stores for the Library's feed filters. Lifted out of
// LibraryView's component-local state so the user's search query and
// date range survive the Library → Post → Library round-trip (the
// router unmounts/remounts Library on each navigation), keeping the
// restored scroll position landing on the same content.
import { writable } from 'svelte/store';
import type { RetainMode } from './retain-mode';

export const filterQuery = writable<string>('');
export const filterFrom = writable<string | null>(null);
export const filterTo = writable<string | null>(null);

// v0.6.0 retain-flag: the Library's "Show" category filter — a view
// filter over the lifecycle flags (synced / lost / unsaved / all),
// distinct from the search and date filters. Default 'synced'.
// See docs/v0.6.0-retain-flag-gui-implementation-plan.md (Task E).
export type ShowFilter = 'synced' | 'lost' | 'unsaved' | 'all';
export const filterShow = writable<ShowFilter>('synced');

/**
 * The "Show" options meaningful under each retain mode — some lifecycle
 * categories can't exist under some modes:
 *   - keep-all  — all four.
 *   - keep-lost — un-saved entries are dropped, so no 'unsaved'.
 *   - sync      — un-saved AND dead-subject entries are gone; only 'all'
 *                 is meaningful. The control is hidden entirely under
 *                 sync — the caller renders it only when this returns
 *                 more than one option.
 * The first entry is the sensible default for that mode.
 */
export function availableShowFilters(mode: RetainMode): ShowFilter[] {
  switch (mode) {
    case 'keep-all':
      return ['synced', 'lost', 'unsaved', 'all'];
    case 'keep-lost':
      return ['synced', 'lost', 'all'];
    case 'sync':
      return ['all'];
  }
}

/**
 * Clear all Library feed filters back to defaults. Call from sign-out
 * or any place where carrying over the previous user's filter state
 * would be inappropriate.
 */
export function resetLibraryFilters(): void {
  filterQuery.set('');
  filterFrom.set(null);
  filterTo.set(null);
  filterShow.set('synced');
}
