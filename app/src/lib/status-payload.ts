import type { InventoryState } from './inventory-loader';
import type { LibraryRefreshState } from './library-refresh';
import type { HydrationProgress } from './hydration-state';
import type { PersistenceMode } from './persistence-mode';
import type { LastSession } from './last-session';

// Locked by R7 in installer-status-panel-resolved.md. The value lives in
// the payload so future tuning is a payload-only change.
const SESSION_TTL_SECONDS = 60;

export interface StatusSnapshotInputs {
  readonly inventoryState: InventoryState;
  readonly libraryRefreshState: LibraryRefreshState;
  readonly fetchProgress: HydrationProgress;
  readonly imageHydration: HydrationProgress;
  readonly articleHydration: HydrationProgress;
  readonly threadProgress: HydrationProgress;
  readonly persistenceMode: PersistenceMode;
  readonly lastSession: LastSession | null;
  readonly browserBytesEstimate: number | null;
  readonly priority?: 'final';
}

export interface StatusPayload {
  readonly schema_version: 1;
  readonly updated_at: string;
  readonly current_state: 'idle' | 'refreshing' | 'hydrating' | 'error';
  readonly priority?: 'final';
  readonly library: {
    readonly handle: string;
    readonly did: string;
    readonly total_saves: number | null;
    readonly by_status: { readonly synced: number; readonly lost: number; readonly unsaved: number };
  };
  readonly hydration: {
    readonly articles?: { readonly completed: number; readonly total: number };
    readonly threads?: { readonly completed: number; readonly total: number };
    readonly images?: { readonly completed: number; readonly total: number };
  };
  readonly storage: {
    readonly mode: 'session' | 'persist';
    readonly session_ttl_seconds: number | null;
    readonly browser_bytes_estimate: number | null;
  };
  readonly last_activity: {
    readonly kind: string;
    readonly started_at: string | null;
    readonly finished_at: string | null;
    readonly added: number;
    readonly removed: number;
    readonly errors: ReadonlyArray<{ kind: string; message: string; count: number }>;
  };
}

// Mirrors feed-filter.ts::matchesShow. Kept inline to keep this module
// dependency-free of /reader. The unknown subject_status case ("neither")
// is intentionally absent from the §4.4 by_status payload — the panel
// only renders the three named buckets.
function categorize(save: { readonly subject_status?: string; readonly removed_detected_at?: string }): 'synced' | 'lost' | 'unsaved' | null {
  if (save.removed_detected_at) return 'unsaved';
  if (save.subject_status === 'not_found' || save.subject_status === 'blocked') return 'lost';
  if (!save.subject_status) return 'synced';
  return null;
}

function countByStatus(saves: ReadonlyArray<{ readonly subject_status?: string; readonly removed_detected_at?: string }>): { synced: number; lost: number; unsaved: number } {
  const counts = { synced: 0, lost: 0, unsaved: 0 };
  for (const s of saves) {
    const cat = categorize(s);
    if (cat !== null) counts[cat]++;
  }
  return counts;
}

function hydrationEntry(h: HydrationProgress): { completed: number; total: number } | undefined {
  if (h.total === 0) return undefined;
  return { completed: h.fetched + h.skipped, total: h.total };
}

export function buildStatusPayload(inputs: StatusSnapshotInputs): StatusPayload | null {
  if (inputs.lastSession === null) return null;

  const totalSaves = inputs.inventoryState.status === 'ready'
    ? inputs.inventoryState.inventory.saves.length
    : null;

  const payload: StatusPayload = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    current_state: 'idle',
    library: {
      handle: inputs.lastSession.handle,
      did: inputs.lastSession.did,
      total_saves: totalSaves,
      by_status: inputs.inventoryState.status === 'ready'
        ? countByStatus(inputs.inventoryState.inventory.saves)
        : { synced: 0, lost: 0, unsaved: 0 },
    },
    hydration: {
      ...(hydrationEntry(inputs.imageHydration) ? { images: hydrationEntry(inputs.imageHydration)! } : {}),
      ...(hydrationEntry(inputs.articleHydration) ? { articles: hydrationEntry(inputs.articleHydration)! } : {}),
      ...(hydrationEntry(inputs.threadProgress) ? { threads: hydrationEntry(inputs.threadProgress)! } : {}),
    },
    storage: {
      mode: inputs.persistenceMode === 'session-only' ? 'session' : 'persist',
      session_ttl_seconds: inputs.persistenceMode === 'session-only' ? SESSION_TTL_SECONDS : null,
      browser_bytes_estimate: inputs.browserBytesEstimate,
    },
    last_activity: {
      kind: 'idle',
      started_at: null,
      finished_at: null,
      added: 0,
      removed: 0,
      errors: [],
    },
  };
  return payload;
}
