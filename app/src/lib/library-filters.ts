// Module-level stores for the Library's feed filters. Lifted out of
// LibraryView's component-local state so the user's search query and
// date range survive the Library → Post → Library round-trip (the
// router unmounts/remounts Library on each navigation), keeping the
// restored scroll position landing on the same content.
import { writable } from 'svelte/store';

export const filterQuery = writable<string>('');
export const filterFrom = writable<string | null>(null);
export const filterTo = writable<string | null>(null);

/**
 * Clear all Library feed filters back to defaults. Call from sign-out
 * or any place where carrying over the previous user's filter state
 * would be inappropriate.
 */
export function resetLibraryFilters(): void {
  filterQuery.set('');
  filterFrom.set(null);
  filterTo.set(null);
}
