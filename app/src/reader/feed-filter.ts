import type { Save } from './inventory-shape';

export interface FilterParams {
  readonly query: string;
  readonly from: string | null; // YYYY-MM-DD or null
  readonly to: string | null;   // YYYY-MM-DD or null
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

export function filterSaves(saves: readonly Save[], params: FilterParams): Save[] {
  return saves.filter(
    (s) =>
      matchesQuery(s, params.query) &&
      matchesFrom(s, params.from) &&
      matchesTo(s, params.to),
  );
}

export function sortByCreatedDesc(saves: readonly Save[]): Save[] {
  return [...saves].sort((a, b) =>
    a.record.createdAt < b.record.createdAt ? 1 : a.record.createdAt > b.record.createdAt ? -1 : 0,
  );
}
