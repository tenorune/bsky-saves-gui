import type { Save } from './inventory-shape';
import type { ShowFilter } from '../lib/library-filters';

export interface FilterParams {
  readonly query: string;
  readonly from: string | null; // YYYY-MM-DD or null
  readonly to: string | null;   // YYYY-MM-DD or null
  // v0.6.0 retain-flag "Show" filter over the lifecycle flags. Optional —
  // absent means 'all' (no lifecycle filtering), which keeps pre-v0.6.0
  // callers and tests valid.
  readonly show?: ShowFilter;
}

function matchesQuery(save: Save, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    save.record.text.toLowerCase().includes(needle) ||
    save.author.handle.toLowerCase().includes(needle) ||
    (save.author.displayName?.toLowerCase().includes(needle) ?? false)
  );
}

function matchesFrom(save: Save, from: string | null): boolean {
  if (!from) return true;
  return save.record.createdAt >= `${from}T00:00:00Z`;
}

function matchesTo(save: Save, to: string | null): boolean {
  if (!to) return true;
  // Inclusive: anything before next-day midnight UTC.
  return save.record.createdAt <= `${to}T23:59:59.999Z`;
}

// v0.6.0 retain-flag. Note: an entry whose subject_status is "unknown"
// (only ever seen via the content-blind listRecords fallback) matches
// none of synced/lost/unsaved — only 'all'. That follows the predicates
// in the requirements doc exactly; flagged here so it isn't a surprise.
function matchesShow(save: Save, show: ShowFilter): boolean {
  switch (show) {
    case 'all':
      return true;
    case 'synced':
      // A normal Bluesky save: not flagged un-saved, subject still live.
      return !save.removed_detected_at && !save.subject_status;
    case 'lost':
      // Removed outside the user's control — poster/system deleted or blocked.
      return save.subject_status === 'not_found' || save.subject_status === 'blocked';
    case 'unsaved':
      // The user un-saved it — the URI vanished from a complete fetch.
      return Boolean(save.removed_detected_at);
  }
}

export function filterSaves(saves: readonly Save[], params: FilterParams): Save[] {
  const show = params.show ?? 'all';
  return saves.filter(
    (s) =>
      matchesQuery(s, params.query) &&
      matchesFrom(s, params.from) &&
      matchesTo(s, params.to) &&
      matchesShow(s, show),
  );
}

export function sortByCreatedDesc(saves: readonly Save[]): Save[] {
  return [...saves].sort((a, b) =>
    a.record.createdAt < b.record.createdAt ? 1 : a.record.createdAt > b.record.createdAt ? -1 : 0,
  );
}
