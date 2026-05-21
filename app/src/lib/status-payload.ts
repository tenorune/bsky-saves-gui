import type { InventoryState } from './inventory-loader';
import type { LibraryRefreshState } from './library-refresh';
import type { HydrationProgress } from './hydration-state';
import type { PersistenceMode } from './persistence-mode';
import type { LastSession } from './last-session';

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
      by_status: { synced: 0, lost: 0, unsaved: 0 },
    },
    hydration: {},
    storage: {
      mode: 'persist',
      session_ttl_seconds: null,
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
