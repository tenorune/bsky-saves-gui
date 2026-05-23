import type { InventoryState } from './inventory-loader';
import type { LibraryRefreshState } from './library-refresh';
import type { HydrationProgress } from './hydration-state';
import type { PersistenceMode } from './persistence-mode';
import type { LastSession } from './last-session';

// Locked by R7 in installer-status-panel-resolved.md. The value lives in
// the payload so future tuning is a payload-only change.
const SESSION_TTL_SECONDS = 60;

export interface LastActivity {
  readonly kind: 'fetch' | 'hydrate_articles' | 'hydrate_threads' | 'hydrate_images' | 'manual_refresh' | 'idle';
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly added: number;
  readonly removed: number;
  readonly errors: ReadonlyArray<{ kind: string; message: string; count: number }>;
}

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
  readonly lastActivity: LastActivity;
  readonly priority?: 'final';
}

export interface StatusPayload {
  readonly schema_version: 1;
  readonly updated_at: string;
  readonly current_state: 'idle' | 'refreshing' | 'hydrating' | 'error';
  readonly priority?: 'final';
  // Present whenever lastSession is set (i.e. for every payload the
  // GUI emits, since buildStatusPayload returns null otherwise). The
  // helper rejects payloads without a library block ("missing field:
  // library") regardless of inventory state, so we always emit one;
  // during cold-start, `total_saves` is `0` and `by_status` is all
  // zeros until the inventory loads. The contract prose at §4.4 says
  // the block is "always present once signed in AND has a non-empty
  // inventory" — the helper interprets this as required-from-signin-
  // onward in practice. See coord-doc Q13.
  readonly library: {
    readonly handle: string;
    readonly did: string;
    readonly total_saves: number;
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

function deriveCurrentState(
  refresh: LibraryRefreshState,
  fetch: HydrationProgress,
  imageH: HydrationProgress,
  articleH: HydrationProgress,
  threadH: HydrationProgress,
): 'idle' | 'refreshing' | 'hydrating' | 'error' {
  if (refresh.status === 'error') return 'error';
  if (refresh.status === 'running') {
    return fetch.status === 'done' ? 'hydrating' : 'refreshing';
  }
  // library-refresh.ts kicks off image / article hydration *after*
  // setting libraryRefreshState back to idle (the hydrators are
  // fire-and-forget; see startLibraryRefresh). Without these checks,
  // current_state drops to 'idle' the moment refresh ends even though
  // image/article/thread hydration may still be running for minutes.
  // See issue #85 (Bug 1) and coordination-doc Q10.
  if (
    imageH.status === 'running' ||
    articleH.status === 'running' ||
    threadH.status === 'running'
  ) {
    return 'hydrating';
  }
  return 'idle';
}

export function buildStatusPayload(inputs: StatusSnapshotInputs): StatusPayload | null {
  if (inputs.lastSession === null) return null;

  // Library block is always emitted (helper requires the field). During
  // cold-start — inventoryState !== 'ready' — `total_saves` is 0 and
  // `by_status` is all-zero; the panel reads `current_state` for the
  // in-flight signal. Once the inventory loads, the block carries the
  // real counts. See coord-doc Q13.
  const inv = inputs.inventoryState;
  const library = inv.status === 'ready'
    ? {
        handle: inputs.lastSession.handle,
        did: inputs.lastSession.did,
        total_saves: inv.inventory.saves.length,
        by_status: countByStatus(inv.inventory.saves),
      }
    : {
        handle: inputs.lastSession.handle,
        did: inputs.lastSession.did,
        total_saves: 0,
        by_status: { synced: 0, lost: 0, unsaved: 0 },
      };

  const payload: StatusPayload = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    current_state: deriveCurrentState(
      inputs.libraryRefreshState,
      inputs.fetchProgress,
      inputs.imageHydration,
      inputs.articleHydration,
      inputs.threadProgress,
    ),
    ...(inputs.priority ? { priority: inputs.priority } : {}),
    library,
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
      kind: inputs.lastActivity.kind,
      started_at: inputs.lastActivity.started_at,
      finished_at: inputs.lastActivity.finished_at,
      added: inputs.lastActivity.added,
      removed: inputs.lastActivity.removed,
      errors: inputs.lastActivity.errors,
    },
  };
  return payload;
}
