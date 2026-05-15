// Persisted expand/collapse state for the Library hub's two collapsible
// panels: the "Backups" block (LibraryStatusPanel — asset rows + helper
// hint) and the "Filters" block (search + show + date range).
//
// Both default to collapsed on first use, then remember the user's
// choice. Reset by Settings → "Reset preferences" (clearPanelCollapse).
// Hydrated at startup by main.ts so the Library renders the correct
// state on first paint instead of flashing open and then snapping shut.

import { writable, type Readable } from 'svelte/store';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

const KEY = 'panel-collapse:v1';

export interface PanelCollapse {
  readonly backups: boolean;
  readonly filters: boolean;
}

const DEFAULT: PanelCollapse = { backups: true, filters: true };

const store = writable<PanelCollapse>(DEFAULT);
export const panelCollapse: Readable<PanelCollapse> = { subscribe: store.subscribe };

function isPanelCollapse(v: unknown): v is PanelCollapse {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { backups?: unknown }).backups === 'boolean' &&
    typeof (v as { filters?: unknown }).filters === 'boolean'
  );
}

export async function loadPanelCollapse(): Promise<void> {
  const raw = await idbGet(KEY);
  store.set(isPanelCollapse(raw) ? raw : DEFAULT);
}

async function setOne<K extends keyof PanelCollapse>(key: K, value: boolean): Promise<void> {
  let next: PanelCollapse = DEFAULT;
  store.update((cur) => {
    next = { ...cur, [key]: value };
    return next;
  });
  await idbSet(KEY, next);
}

export async function setBackupsCollapsed(v: boolean): Promise<void> {
  await setOne('backups', v);
}

export async function setFiltersCollapsed(v: boolean): Promise<void> {
  await setOne('filters', v);
}

export async function clearPanelCollapse(): Promise<void> {
  store.set(DEFAULT);
  await idbDel(KEY);
}

export function _resetPanelCollapseForTests(): void {
  store.set(DEFAULT);
}
