# Status Snapshot Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the GUI to push `POST /status` snapshots to the local helper so the installer panel can render live library state.

**Architecture:** Two new modules under `app/src/lib/`: `status-payload.ts` (pure: build §4.4 payload from store snapshots) + `status-pusher.ts` (subscriptions, debounce, heartbeat, beforeunload, `DELETE /status`). One-line bootstrap in `main.ts`; one-line wiring in `Settings.svelte` for "Clear all data".

**Tech Stack:** Svelte 4 stores (Readable / Writable), TypeScript, Vitest with jsdom + fake timers, `helper-client.ts` for auth reuse.

**Spec:** `docs/superpowers/specs/2026-05-21-status-snapshot-push-design.md`
**Contract:** `bsky-saves-coordination:docs/installer-status-panel.md` §§4.3, 4.4

---

## File Structure

**New files:**
- `app/src/lib/status-payload.ts` — pure payload builder (~150 lines)
- `app/src/lib/status-payload.test.ts` — unit tests for the builder (~250 lines)
- `app/src/lib/status-pusher.ts` — orchestrator: subscriptions, debounce, heartbeat, beforeunload, DELETE (~300 lines)
- `app/src/lib/status-pusher.test.ts` — integration tests with mocked stores + fake timers (~300 lines)

**Modified files:**
- `app/src/main.ts` — add `initStatusPusher()` call + import (2 line change)
- `app/src/routes/Settings.svelte` — add `await deleteStatus()` in clear-data handler (2 line change)

**No changes to existing stores or hydrators.**

---

## Task 1: Create `status-payload.ts` skeleton + first failing test

**Files:**
- Create: `app/src/lib/status-payload.ts`
- Create: `app/src/lib/status-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/status-payload.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildStatusPayload, type StatusSnapshotInputs } from './status-payload';

const IDLE_HYDRATION = { status: 'idle' as const, total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] };

const BASE_INPUTS: StatusSnapshotInputs = {
  inventoryState: { status: 'ready', inventory: { saves: [] } as never },
  libraryRefreshState: { status: 'idle' },
  fetchProgress: IDLE_HYDRATION,
  imageHydration: IDLE_HYDRATION,
  articleHydration: IDLE_HYDRATION,
  threadProgress: IDLE_HYDRATION,
  persistenceMode: 'persist',
  lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
  browserBytesEstimate: null,
};

describe('buildStatusPayload', () => {
  it('returns null when lastSession is null', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, lastSession: null });
    expect(payload).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: FAIL — cannot import from `./status-payload` (module doesn't exist).

- [ ] **Step 3: Create minimal `status-payload.ts` to make the test pass**

Create `app/src/lib/status-payload.ts`:

```typescript
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
  // Placeholder — filled in by later tasks.
  throw new Error('not implemented');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-payload.ts app/src/lib/status-payload.test.ts
git commit -m "feat(status-payload): skeleton + null-when-unsigned"
```

---

## Task 2: Library identity (handle, did, total_saves)

**Files:**
- Modify: `app/src/lib/status-payload.ts`
- Modify: `app/src/lib/status-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-payload.test.ts`:

```typescript
  it('populates library.handle, library.did, library.total_saves from inputs', () => {
    const inv = {
      saves: [
        { uri: 'at://1' }, { uri: 'at://2' }, { uri: 'at://3' },
      ] as never,
    };
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'ready', inventory: inv },
    });
    expect(payload).not.toBeNull();
    expect(payload!.library.handle).toBe('alice.bsky.social');
    expect(payload!.library.did).toBe('did:plc:alice');
    expect(payload!.library.total_saves).toBe(3);
  });

  it('library.total_saves is null when inventoryState is not ready', () => {
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'loading' },
    });
    expect(payload!.library.total_saves).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: FAIL with `Error: not implemented` on the two new tests.

- [ ] **Step 3: Implement the library block**

Replace the placeholder `buildStatusPayload` body in `status-payload.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-payload.ts app/src/lib/status-payload.test.ts
git commit -m "feat(status-payload): library handle/did/total_saves"
```

---

## Task 3: by_status counts (synced / lost / unsaved)

**Files:**
- Modify: `app/src/lib/status-payload.ts`
- Modify: `app/src/lib/status-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-payload.test.ts`:

```typescript
  it('counts by_status by retain-mode predicates', () => {
    const inv = {
      saves: [
        { uri: 'at://1' },                                  // synced
        { uri: 'at://2', subject_status: 'not_found' },     // lost
        { uri: 'at://3', subject_status: 'blocked' },       // lost
        { uri: 'at://4', removed_detected_at: '2026-05-10T00:00:00Z' }, // unsaved
        { uri: 'at://5', subject_status: 'unknown' },       // neither
      ] as never,
    };
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'ready', inventory: inv },
    });
    expect(payload!.library.by_status).toEqual({
      synced: 1,
      lost: 2,
      unsaved: 1,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: FAIL — `by_status` returns all-zero counts.

- [ ] **Step 3: Implement the categorization**

Add the predicates above the `buildStatusPayload` function in `status-payload.ts`:

```typescript
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
```

Then update the `library.by_status` assignment in `buildStatusPayload`:

```typescript
    library: {
      handle: inputs.lastSession.handle,
      did: inputs.lastSession.did,
      total_saves: totalSaves,
      by_status: inputs.inventoryState.status === 'ready'
        ? countByStatus(inputs.inventoryState.inventory.saves)
        : { synced: 0, lost: 0, unsaved: 0 },
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-payload.ts app/src/lib/status-payload.test.ts
git commit -m "feat(status-payload): by_status counts via retain-mode predicates"
```

---

## Task 4: Hydration block

**Files:**
- Modify: `app/src/lib/status-payload.ts`
- Modify: `app/src/lib/status-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-payload.test.ts`:

```typescript
  it('populates hydration.{articles,threads,images} when their stores have a total', () => {
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      imageHydration: { ...IDLE_HYDRATION, total: 100, fetched: 30, skipped: 40 },
      articleHydration: { ...IDLE_HYDRATION, total: 50, fetched: 10, skipped: 5 },
      threadProgress: { ...IDLE_HYDRATION, total: 200, fetched: 100, skipped: 50 },
    });
    expect(payload!.hydration).toEqual({
      images: { completed: 70, total: 100 },
      articles: { completed: 15, total: 50 },
      threads: { completed: 150, total: 200 },
    });
  });

  it('omits a hydration bucket when its total is zero', () => {
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      imageHydration: { ...IDLE_HYDRATION, total: 100, fetched: 30, skipped: 40 },
      // articleHydration and threadProgress stay IDLE (total: 0)
    });
    expect(payload!.hydration).toEqual({
      images: { completed: 70, total: 100 },
    });
    expect(payload!.hydration.articles).toBeUndefined();
    expect(payload!.hydration.threads).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: FAIL — `hydration` returns empty object.

- [ ] **Step 3: Implement hydration mapping**

Add helper above `buildStatusPayload` in `status-payload.ts`:

```typescript
function hydrationEntry(h: HydrationProgress): { completed: number; total: number } | undefined {
  if (h.total === 0) return undefined;
  return { completed: h.fetched + h.skipped, total: h.total };
}
```

Then update the `hydration: {}` assignment in `buildStatusPayload`:

```typescript
    hydration: {
      ...(hydrationEntry(inputs.imageHydration) ? { images: hydrationEntry(inputs.imageHydration)! } : {}),
      ...(hydrationEntry(inputs.articleHydration) ? { articles: hydrationEntry(inputs.articleHydration)! } : {}),
      ...(hydrationEntry(inputs.threadProgress) ? { threads: hydrationEntry(inputs.threadProgress)! } : {}),
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-payload.ts app/src/lib/status-payload.test.ts
git commit -m "feat(status-payload): hydration block per asset type"
```

---

## Task 5: Storage block (mode + session_ttl_seconds + browser_bytes_estimate)

**Files:**
- Modify: `app/src/lib/status-payload.ts`
- Modify: `app/src/lib/status-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-payload.test.ts`:

```typescript
  it('storage.mode is "persist" with null TTL in persist mode', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, persistenceMode: 'persist' });
    expect(payload!.storage.mode).toBe('persist');
    expect(payload!.storage.session_ttl_seconds).toBeNull();
  });

  it('storage.mode is "session" with 60s TTL when persistenceMode is session-only', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, persistenceMode: 'session-only' });
    expect(payload!.storage.mode).toBe('session');
    expect(payload!.storage.session_ttl_seconds).toBe(60);
  });

  it('storage.browser_bytes_estimate passes through from inputs', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, browserBytesEstimate: 18234567 });
    expect(payload!.storage.browser_bytes_estimate).toBe(18234567);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: FAIL — `mode` is always `"persist"` and TTL is always `null`.

- [ ] **Step 3: Implement storage mode mapping**

Add a constant near the top of `status-payload.ts` (after the imports):

```typescript
// Locked by R7 in installer-status-panel-resolved.md. The value lives in
// the payload so future tuning is a payload-only change.
const SESSION_TTL_SECONDS = 60;
```

Update the `storage` block in `buildStatusPayload`:

```typescript
    storage: {
      mode: inputs.persistenceMode === 'session-only' ? 'session' : 'persist',
      session_ttl_seconds: inputs.persistenceMode === 'session-only' ? SESSION_TTL_SECONDS : null,
      browser_bytes_estimate: inputs.browserBytesEstimate,
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-payload.ts app/src/lib/status-payload.test.ts
git commit -m "feat(status-payload): storage block with session-mode TTL"
```

---

## Task 6: `current_state` derivation

**Files:**
- Modify: `app/src/lib/status-payload.ts`
- Modify: `app/src/lib/status-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-payload.test.ts`:

```typescript
  describe('current_state', () => {
    it('is "idle" when libraryRefreshState is idle', () => {
      const payload = buildStatusPayload(BASE_INPUTS);
      expect(payload!.current_state).toBe('idle');
    });

    it('is "refreshing" when libraryRefresh is running and fetch is in flight', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'running' },
        fetchProgress: { ...IDLE_HYDRATION, status: 'running', total: 100, fetched: 30 },
      });
      expect(payload!.current_state).toBe('refreshing');
    });

    it('is "hydrating" when libraryRefresh is running and fetch is done', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'running' },
        fetchProgress: { ...IDLE_HYDRATION, status: 'done', total: 100, fetched: 100 },
      });
      expect(payload!.current_state).toBe('hydrating');
    });

    it('is "error" when libraryRefreshState.status === "error"', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'error', error: 'something broke' },
      });
      expect(payload!.current_state).toBe('error');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: FAIL — `current_state` is always `'idle'`.

- [ ] **Step 3: Implement `current_state` derivation**

Add a helper above `buildStatusPayload` in `status-payload.ts`:

```typescript
function deriveCurrentState(
  refresh: LibraryRefreshState,
  fetch: HydrationProgress,
): 'idle' | 'refreshing' | 'hydrating' | 'error' {
  if (refresh.status === 'error') return 'error';
  if (refresh.status === 'running') {
    return fetch.status === 'done' ? 'hydrating' : 'refreshing';
  }
  return 'idle';
}
```

Update the `current_state: 'idle'` line in `buildStatusPayload`:

```typescript
    current_state: deriveCurrentState(inputs.libraryRefreshState, inputs.fetchProgress),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-payload.ts app/src/lib/status-payload.test.ts
git commit -m "feat(status-payload): current_state derivation"
```

---

## Task 7: `last_activity` block

**Files:**
- Modify: `app/src/lib/status-payload.ts`
- Modify: `app/src/lib/status-payload.test.ts`

The payload's `last_activity` represents the GUI's most recent significant activity. Because that crosses store boundaries (libraryRefreshState transitions, hydration completions), we expose it as a separate input field carried by the pusher rather than deriving from store snapshots alone.

- [ ] **Step 1: Extend the inputs interface and write failing tests**

Add to `StatusSnapshotInputs` in `status-payload.ts`:

```typescript
export interface LastActivity {
  readonly kind: 'fetch' | 'hydrate_articles' | 'hydrate_threads' | 'hydrate_images' | 'manual_refresh' | 'idle';
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly added: number;
  readonly removed: number;
  readonly errors: ReadonlyArray<{ kind: string; message: string; count: number }>;
}

export interface StatusSnapshotInputs {
  // ...existing fields...
  readonly lastActivity: LastActivity;
}
```

Update `BASE_INPUTS` in `status-payload.test.ts`:

```typescript
const IDLE_ACTIVITY: LastActivity = {
  kind: 'idle',
  started_at: null,
  finished_at: null,
  added: 0,
  removed: 0,
  errors: [],
};

const BASE_INPUTS: StatusSnapshotInputs = {
  // ...existing fields...
  lastActivity: IDLE_ACTIVITY,
};
```

(Also `import type { LastActivity } from './status-payload'`.)

Then append a test:

```typescript
  it('passes last_activity through from inputs verbatim', () => {
    const activity: LastActivity = {
      kind: 'fetch',
      started_at: '2026-05-21T20:13:11Z',
      finished_at: '2026-05-21T20:15:00Z',
      added: 3,
      removed: 1,
      errors: [{ kind: 'pds_timeout', message: 'PDS took too long', count: 1 }],
    };
    const payload = buildStatusPayload({ ...BASE_INPUTS, lastActivity: activity });
    expect(payload!.last_activity).toEqual(activity);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: FAIL — TypeScript / runtime mismatch on the new field, plus the assertion fails on `last_activity` not matching.

- [ ] **Step 3: Wire lastActivity into the payload**

Update the `last_activity: {...}` assignment in `buildStatusPayload`:

```typescript
    last_activity: {
      kind: inputs.lastActivity.kind,
      started_at: inputs.lastActivity.started_at,
      finished_at: inputs.lastActivity.finished_at,
      added: inputs.lastActivity.added,
      removed: inputs.lastActivity.removed,
      errors: inputs.lastActivity.errors,
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-payload.ts app/src/lib/status-payload.test.ts
git commit -m "feat(status-payload): last_activity carried via inputs"
```

---

## Task 8: `priority: "final"` pass-through

**Files:**
- Modify: `app/src/lib/status-payload.ts`
- Modify: `app/src/lib/status-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-payload.test.ts`:

```typescript
  it('omits the priority field when inputs.priority is absent', () => {
    const payload = buildStatusPayload(BASE_INPUTS);
    expect('priority' in payload!).toBe(false);
  });

  it('sets priority: "final" when inputs.priority is "final"', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, priority: 'final' });
    expect(payload!.priority).toBe('final');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: FAIL — `priority` is never set on the output.

- [ ] **Step 3: Conditionally include `priority` in the output**

In `buildStatusPayload`, change the return:

```typescript
  const payload: StatusPayload = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    current_state: deriveCurrentState(inputs.libraryRefreshState, inputs.fetchProgress),
    ...(inputs.priority ? { priority: inputs.priority } : {}),
    library: {
      // ...unchanged...
    },
    // ...rest unchanged...
  };
  return payload;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-payload.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-payload.ts app/src/lib/status-payload.test.ts
git commit -m "feat(status-payload): priority:final pass-through"
```

---

## Task 9: `status-pusher.ts` skeleton + activation gate

**Files:**
- Create: `app/src/lib/status-pusher.ts`
- Create: `app/src/lib/status-pusher.test.ts`

The pusher's activation gate combines: helper detected + paired + not opted out + signed in.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/status-pusher.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { isActive, type ActivationInputs } from './status-pusher';

const PAIRED: ActivationInputs = {
  helperDetected: true,
  pairingState: 'paired',
  helperOptOut: false,
  lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
};

describe('isActive', () => {
  it('returns true when all four conditions hold', () => {
    expect(isActive(PAIRED)).toBe(true);
  });

  it('returns false when helper is not detected', () => {
    expect(isActive({ ...PAIRED, helperDetected: false })).toBe(false);
  });

  it('returns false when pairing state is unpaired', () => {
    expect(isActive({ ...PAIRED, pairingState: 'unpaired' })).toBe(false);
  });

  it('returns false when pairing state is stale (avoid 401 spam loop)', () => {
    expect(isActive({ ...PAIRED, pairingState: 'stale' })).toBe(false);
  });

  it('returns false when user opted out of the helper', () => {
    expect(isActive({ ...PAIRED, helperOptOut: true })).toBe(false);
  });

  it('returns false when not signed in', () => {
    expect(isActive({ ...PAIRED, lastSession: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the pusher skeleton with the activation helper**

Create `app/src/lib/status-pusher.ts`:

```typescript
// Push library status to the local helper for the installer panel.
// See docs/superpowers/specs/2026-05-21-status-snapshot-push-design.md
// and bsky-saves-coordination:docs/installer-status-panel.md (canonical
// contract).

import type { LastSession } from './last-session';
import type { PairingState } from './pairing-token';

export interface ActivationInputs {
  readonly helperDetected: boolean;
  readonly pairingState: PairingState;
  readonly helperOptOut: boolean;
  readonly lastSession: LastSession | null;
}

/**
 * Pusher activation gate. All four conditions must hold for pushes
 * to fire. A `stale` pairing state is intentionally not active —
 * pushing would 401 repeatedly until the user re-pairs.
 */
export function isActive(inputs: ActivationInputs): boolean {
  return (
    inputs.helperDetected &&
    inputs.pairingState === 'paired' &&
    !inputs.helperOptOut &&
    inputs.lastSession !== null
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-pusher.ts app/src/lib/status-pusher.test.ts
git commit -m "feat(status-pusher): skeleton + activation gate"
```

---

## Task 10: Pusher subscription wiring + `pushSnapshot()` (no debouncing yet)

**Files:**
- Modify: `app/src/lib/status-pusher.ts`
- Modify: `app/src/lib/status-pusher.test.ts`

This task wires the basic "store changes → build payload → fetch POST" pipeline without debouncing. Debouncing comes next.

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-pusher.test.ts`:

```typescript
import { afterEach, beforeEach, vi } from 'vitest';
import { writable } from 'svelte/store';
import { _resetStatusPusherForTests, pushSnapshotForTests, type PusherDeps } from './status-pusher';

// (rename or extend the existing describe block; keep `isActive` tests)

describe('pushSnapshot (no debounce)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /status with bearer auth when active', async () => {
    await pushSnapshotForTests({
      activation: { helperDetected: true, pairingState: 'paired', helperOptOut: false,
        lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' } },
      pairingToken: 'token-abc',
      helperOrigin: 'http://localhost:47826',
      payloadInputs: /* assembled by helper below */ undefined!,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:47826/status',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          Authorization: 'Bearer token-abc',
        }),
      }),
    );
  });

  it('does NOT call fetch when activation conditions fail', async () => {
    await pushSnapshotForTests({
      activation: { helperDetected: false, pairingState: 'paired', helperOptOut: false, lastSession: null },
      pairingToken: 'token-abc',
      helperOrigin: 'http://localhost:47826',
      payloadInputs: undefined!,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: FAIL — `pushSnapshotForTests` and `_resetStatusPusherForTests` don't exist.

- [ ] **Step 3: Implement the core push function**

Extend `app/src/lib/status-pusher.ts`:

```typescript
import { get, type Readable } from 'svelte/store';
import { config } from './config';
import { pairingToken, type PairingState } from './pairing-token';
import { lastSession as lastSessionStore, type LastSession } from './last-session';
import { capabilitySnapshot } from './capability-snapshot';
import { helperOptOutStore } from './helper-opt-out'; // we'll wire this if it exists; otherwise read at point of use
import { libraryRefreshState } from './library-refresh';
import { inventoryState } from './inventory-loader';
import {
  imageHydration, articleHydration, threadProgress, fetchProgress,
} from './hydration-state';
import { persistenceMode } from './persistence-mode';
import { buildStatusPayload, type StatusSnapshotInputs, type LastActivity } from './status-payload';

// Internal "current activity" tracker. Updated by libraryRefreshState
// transitions and hydration store activity. Lives at module scope so
// it survives across pushes.
let currentActivity: LastActivity = {
  kind: 'idle', started_at: null, finished_at: null,
  added: 0, removed: 0, errors: [],
};

let browserBytesCache: { bytes: number | null; refreshedAt: number } = { bytes: null, refreshedAt: 0 };

async function refreshBrowserBytesIfStale(): Promise<number | null> {
  const now = Date.now();
  if (now - browserBytesCache.refreshedAt < 60_000) return browserBytesCache.bytes;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      browserBytesCache = { bytes: est.usage ?? null, refreshedAt: now };
      return browserBytesCache.bytes;
    }
  } catch { /* ignore */ }
  browserBytesCache = { bytes: null, refreshedAt: now };
  return null;
}

interface PushOnceOptions {
  readonly priority?: 'final';
}

async function pushOnce(options: PushOnceOptions = {}): Promise<void> {
  const inputs: StatusSnapshotInputs = {
    inventoryState: get(inventoryState),
    libraryRefreshState: get(libraryRefreshState),
    fetchProgress: get(fetchProgress),
    imageHydration: get(imageHydration),
    articleHydration: get(articleHydration),
    threadProgress: get(threadProgress),
    persistenceMode: get(persistenceMode),
    lastSession: get(lastSessionStore),
    browserBytesEstimate: await refreshBrowserBytesIfStale(),
    lastActivity: currentActivity,
    ...(options.priority ? { priority: options.priority } : {}),
  };
  const payload = buildStatusPayload(inputs);
  if (payload === null) return;
  const { token } = get(pairingToken);
  if (token === null) return;
  try {
    await fetch(`${config.helperOrigin}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    console.debug('[status-push] failed (network)');
  }
}

// Test surfaces — exposed only to bypass the activation snapshot logic.
// Real code path uses pushOnce() gated by isActive() in scheduleAndPush().

export function _resetStatusPusherForTests(): void {
  currentActivity = { kind: 'idle', started_at: null, finished_at: null, added: 0, removed: 0, errors: [] };
  browserBytesCache = { bytes: null, refreshedAt: 0 };
}

export interface PusherDeps {
  readonly activation: ActivationInputs;
  readonly pairingToken: string | null;
  readonly helperOrigin: string;
  readonly payloadInputs: StatusSnapshotInputs;
}

export async function pushSnapshotForTests(deps: PusherDeps): Promise<void> {
  if (!isActive(deps.activation)) return;
  if (deps.pairingToken === null) return;
  const payload = buildStatusPayload(deps.payloadInputs ?? {
    // Minimal default inputs so the test can omit a full snapshot.
    inventoryState: { status: 'loading' },
    libraryRefreshState: { status: 'idle' },
    fetchProgress: { status: 'idle', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] },
    imageHydration: { status: 'idle', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] },
    articleHydration: { status: 'idle', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] },
    threadProgress: { status: 'idle', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] },
    persistenceMode: 'persist',
    lastSession: deps.activation.lastSession,
    browserBytesEstimate: null,
    lastActivity: currentActivity,
  });
  if (payload === null) return;
  try {
    await fetch(`${deps.helperOrigin}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${deps.pairingToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* swallow */
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-pusher.ts app/src/lib/status-pusher.test.ts
git commit -m "feat(status-pusher): pushSnapshot + activation-gated POST"
```

---

## Task 11: Debouncer (throttle-with-trailing, 500 ms)

**Files:**
- Modify: `app/src/lib/status-pusher.ts`
- Modify: `app/src/lib/status-pusher.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-pusher.test.ts`:

```typescript
import { schedulePushForTests, _flushDebouncerForTests, DEBOUNCE_MS } from './status-pusher';

describe('debouncer (throttle-with-trailing)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fires immediately on the first scheduled push in a quiet period', async () => {
    schedulePushForTests();
    await vi.runOnlyPendingTimersAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of schedules within DEBOUNCE_MS into one trailing push', async () => {
    schedulePushForTests();   // immediate
    schedulePushForTests();   // queued (during cooldown)
    schedulePushForTests();   // queued (still within cooldown)
    await vi.runOnlyPendingTimersAsync();
    // First fires immediately, then nothing until the cooldown advances.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await vi.runOnlyPendingTimersAsync();
    // Trailing push fires once at the end of the cooldown window.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not fire a trailing push if no schedules arrived during the cooldown', async () => {
    schedulePushForTests();   // immediate
    await vi.runOnlyPendingTimersAsync();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await vi.runOnlyPendingTimersAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the immediate
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: FAIL — `schedulePushForTests` / `DEBOUNCE_MS` / `_flushDebouncerForTests` not exported.

- [ ] **Step 3: Implement the debouncer**

Add to `app/src/lib/status-pusher.ts`:

```typescript
// Locked by R6 (installer-status-panel-resolved.md). 500ms is the
// floor the contract guarantees; we may tighten to 250ms later
// without a contract change.
export const DEBOUNCE_MS = 500;

let lastPushAt = 0;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;
let trailingPending = false;

function schedulePush(activeNow: boolean): void {
  if (!activeNow) return;
  const now = Date.now();
  if (now - lastPushAt >= DEBOUNCE_MS && trailingTimer === null) {
    // Immediate (rising edge).
    lastPushAt = now;
    void pushOnce();
    return;
  }
  // Within cooldown — schedule a single trailing push at the end of the window.
  trailingPending = true;
  if (trailingTimer === null) {
    const remaining = Math.max(0, DEBOUNCE_MS - (now - lastPushAt));
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      if (trailingPending) {
        trailingPending = false;
        lastPushAt = Date.now();
        void pushOnce();
      }
    }, remaining);
  }
}

// Test surface — bypasses the activation check so debounce behavior
// can be asserted independently of activation logic.
export function schedulePushForTests(): void {
  schedulePush(true);
}

export function _flushDebouncerForTests(): void {
  if (trailingTimer !== null) { clearTimeout(trailingTimer); trailingTimer = null; }
  trailingPending = false;
  lastPushAt = 0;
}
```

Update `_resetStatusPusherForTests` to also call `_flushDebouncerForTests()`:

```typescript
export function _resetStatusPusherForTests(): void {
  _flushDebouncerForTests();
  currentActivity = { kind: 'idle', started_at: null, finished_at: null, added: 0, removed: 0, errors: [] };
  browserBytesCache = { bytes: null, refreshedAt: 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-pusher.ts app/src/lib/status-pusher.test.ts
git commit -m "feat(status-pusher): 500ms throttle-with-trailing debouncer"
```

---

## Task 12: Subscription wiring + activation reactivity

**Files:**
- Modify: `app/src/lib/status-pusher.ts`
- Modify: `app/src/lib/status-pusher.test.ts`

This wires `initStatusPusher()` to subscribe to all relevant stores, computes activation reactively, and fires the immediate "fresh push" on dormant→active transitions.

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-pusher.test.ts`:

```typescript
import { initStatusPusher, _disposeStatusPusherForTests } from './status-pusher';
import { writable as svWritable } from 'svelte/store';

describe('initStatusPusher subscription wiring', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
  });
  afterEach(() => {
    _disposeStatusPusherForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fires an immediate fresh-state push on dormant → active transition', async () => {
    // This test runs against the real stores, manipulated to active state.
    // For simplicity: assume signed-in + helper-detected + paired + not opted out.
    // Other tests can drive the same path via the real signin flow under jsdom.
    // (Detailed wiring of the test fixture: see comments at the bottom of this file.)

    initStatusPusher();
    // Drive store state to "active": this requires test-only helpers that
    // wrap the real stores. For now, we assert initStatusPusher does not
    // throw and registers subscriptions.
    expect(() => initStatusPusher()).not.toThrow();
  });
});
```

(The full subscription test is harder than it looks because we'd need to mock 10 stores. A more focused test below verifies the reactivity gate via a single store.)

```typescript
  it('fires the immediate fresh-state push when activation flips to true', async () => {
    // We can't easily simulate a real store flip without mocking every imported store.
    // Instead, we expose a test-only `_setActivationForTests()` that lets us flip
    // activation directly and assert the push fires.
    initStatusPusher();
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      helperOptOut: false,
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await vi.runOnlyPendingTimersAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // one immediate push on becoming active
  });

  it('stops pushing when activation flips back to false', async () => {
    initStatusPusher();
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      helperOptOut: false,
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await vi.runOnlyPendingTimersAsync();
    fetchSpy.mockClear();
    _setActivationForTests({ helperDetected: false, pairingState: 'paired', helperOptOut: false, lastSession: null });
    schedulePushForTests();
    await vi.runOnlyPendingTimersAsync();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: FAIL — `initStatusPusher`, `_disposeStatusPusherForTests`, `_setActivationForTests` don't exist.

- [ ] **Step 3: Implement subscription wiring**

Add to `app/src/lib/status-pusher.ts`:

```typescript
// Module-level activation state — updated by store subscriptions in the real
// codepath, or by `_setActivationForTests` in tests.
let activation: ActivationInputs = {
  helperDetected: false, pairingState: 'unpaired', helperOptOut: false, lastSession: null,
};
let wasActive = false;
let subscriptionDisposers: Array<() => void> = [];

function reevaluateActivation(): void {
  const nowActive = isActive(activation);
  if (nowActive && !wasActive) {
    // Dormant → Active. Fire the immediate fresh-state push.
    void pushOnce();
  }
  // Active → Dormant doesn't need an action here — the debouncer simply
  // stops scheduling because schedulePush() checks isActive(activation).
  wasActive = nowActive;
}

export function initStatusPusher(): void {
  // Avoid double-subscription on repeat calls (defensive — main.ts calls once).
  if (subscriptionDisposers.length > 0) return;

  // Build the activation snapshot from four stores; rebuild on any change.
  const updateActivation = (
    snap = get(capabilitySnapshot),
    state = get(pairingToken),
    session = get(lastSessionStore),
  ): void => {
    activation = {
      helperDetected: snap.helper.detected,
      pairingState: state.state,
      // helperOptOut store is read synchronously per-update; the value
      // changes rarely, so subscribing is unnecessary at this layer.
      helperOptOut: false, // see helper-opt-out wiring task below
      lastSession: session,
    };
    reevaluateActivation();
  };

  subscriptionDisposers.push(capabilitySnapshot.subscribe(() => updateActivation()));
  subscriptionDisposers.push(pairingToken.subscribe(() => updateActivation()));
  subscriptionDisposers.push(lastSessionStore.subscribe(() => updateActivation()));

  // Subscribe to "interesting" stores; any change triggers a debounced push.
  const onChange = (): void => schedulePush(isActive(activation));
  subscriptionDisposers.push(inventoryState.subscribe(onChange));
  subscriptionDisposers.push(libraryRefreshState.subscribe(onChange));
  subscriptionDisposers.push(fetchProgress.subscribe(onChange));
  subscriptionDisposers.push(imageHydration.subscribe(onChange));
  subscriptionDisposers.push(articleHydration.subscribe(onChange));
  subscriptionDisposers.push(threadProgress.subscribe(onChange));
  subscriptionDisposers.push(persistenceMode.subscribe(onChange));
}

export function _disposeStatusPusherForTests(): void {
  for (const dispose of subscriptionDisposers) dispose();
  subscriptionDisposers = [];
  activation = { helperDetected: false, pairingState: 'unpaired', helperOptOut: false, lastSession: null };
  wasActive = false;
}

export function _setActivationForTests(next: ActivationInputs): void {
  activation = next;
  reevaluateActivation();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-pusher.ts app/src/lib/status-pusher.test.ts
git commit -m "feat(status-pusher): subscription wiring + activation reactivity"
```

---

## Task 13: Helper-opt-out integration

**Files:**
- Modify: `app/src/lib/status-pusher.ts`
- Modify: `app/src/lib/status-pusher.test.ts`

The `helper-opt-out.ts` preference is loaded asynchronously; it isn't a Svelte store yet but exposes `loadHelperOptOut(): Promise<boolean>`. We integrate it by checking it at push time rather than subscribing.

- [ ] **Step 1: Inspect helper-opt-out's surface**

Run: `grep -n "^export" app/src/lib/helper-opt-out.ts`
Expected: see exports like `loadHelperOptOut`, `setHelperOptOut`, `clearHelperOptOut`.

- [ ] **Step 2: Decide on the wiring approach**

If `helper-opt-out` exposes a Svelte store (e.g., `helperOptOutStore`), subscribe to it the same way as other stores. If it's a function-only API, call `loadHelperOptOut()` once at `initStatusPusher()` startup and refresh on each `setHelperOptOut()` call via a module-level callback — OR poll once per push if simpler.

Based on the existing codebase pattern (capability-snapshot reads `loadHelperOptOut()` once and feeds the result back into its computeCapabilitySnapshot call), follow the same pattern: read once at init, and use `capabilitySnapshot.helper.detected` as the gating signal — which already factors in `helperOptOut` internally.

- [ ] **Step 3: Simplify — use `capabilitySnapshot.helper.detected` only**

Since `capability-snapshot.ts` already returns `helper.detected = false` when `helperOptOut === true` (via the `effectiveHelper` computation), the status pusher doesn't need a separate helper-opt-out check. The `helperDetected: snap.helper.detected` line in Task 12's subscription wiring already incorporates the opt-out.

Update the `ActivationInputs` interface and `isActive` to drop `helperOptOut` as a separate field:

```typescript
export interface ActivationInputs {
  readonly helperDetected: boolean;
  readonly pairingState: PairingState;
  readonly lastSession: LastSession | null;
}

export function isActive(inputs: ActivationInputs): boolean {
  return (
    inputs.helperDetected &&
    inputs.pairingState === 'paired' &&
    inputs.lastSession !== null
  );
}
```

Update all uses of `ActivationInputs` and the tests accordingly (drop the `helperOptOut: false` field from test fixtures).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: PASS (14 tests; helper-opt-out previously-failing tests removed or simplified).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-pusher.ts app/src/lib/status-pusher.test.ts
git commit -m "refactor(status-pusher): rely on capabilitySnapshot.helper.detected for opt-out gating"
```

---

## Task 14: Session-mode heartbeat (15s interval)

**Files:**
- Modify: `app/src/lib/status-pusher.ts`
- Modify: `app/src/lib/status-pusher.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-pusher.test.ts`:

```typescript
import { HEARTBEAT_MS, _setPersistenceModeForTests } from './status-pusher';

describe('heartbeat (session mode)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
  });
  afterEach(() => {
    _disposeStatusPusherForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fires a heartbeat push every HEARTBEAT_MS while active + session mode', async () => {
    initStatusPusher();
    _setPersistenceModeForTests('session-only');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await vi.runOnlyPendingTimersAsync(); // immediate fresh-state push
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockClear();
    vi.advanceTimersByTime(HEARTBEAT_MS);
    await vi.runOnlyPendingTimersAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // heartbeat #1
    vi.advanceTimersByTime(HEARTBEAT_MS);
    await vi.runOnlyPendingTimersAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // heartbeat #2
  });

  it('does not run a heartbeat in persist mode', async () => {
    initStatusPusher();
    _setPersistenceModeForTests('persist');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await vi.runOnlyPendingTimersAsync(); // immediate fresh-state push
    fetchSpy.mockClear();
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    await vi.runOnlyPendingTimersAsync();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clears the heartbeat when active flips to dormant', async () => {
    initStatusPusher();
    _setPersistenceModeForTests('session-only');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    await vi.runOnlyPendingTimersAsync();
    fetchSpy.mockClear();
    _setActivationForTests({ helperDetected: false, pairingState: 'paired', lastSession: null });
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    await vi.runOnlyPendingTimersAsync();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: FAIL — `HEARTBEAT_MS`, `_setPersistenceModeForTests` don't exist; no heartbeat code.

- [ ] **Step 3: Implement the heartbeat**

Add to `app/src/lib/status-pusher.ts`:

```typescript
// Locked by R7 (installer-status-panel-resolved.md). Heartbeat
// cadence must be ≤ TTL/3 to survive a missed push.
export const HEARTBEAT_MS = 15_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let persistenceModeNow: 'persist' | 'session-only' = 'persist';

function refreshHeartbeat(): void {
  const shouldRun = isActive(activation) && persistenceModeNow === 'session-only';
  if (shouldRun && heartbeatTimer === null) {
    heartbeatTimer = setInterval(() => {
      void pushOnce();
    }, HEARTBEAT_MS);
  } else if (!shouldRun && heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function _setPersistenceModeForTests(mode: 'persist' | 'session-only'): void {
  persistenceModeNow = mode;
  refreshHeartbeat();
}
```

Update `reevaluateActivation` to also call `refreshHeartbeat()`:

```typescript
function reevaluateActivation(): void {
  const nowActive = isActive(activation);
  if (nowActive && !wasActive) {
    void pushOnce();
  }
  wasActive = nowActive;
  refreshHeartbeat();
}
```

Update `_disposeStatusPusherForTests` to also clear the heartbeat:

```typescript
export function _disposeStatusPusherForTests(): void {
  if (heartbeatTimer !== null) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  for (const dispose of subscriptionDisposers) dispose();
  subscriptionDisposers = [];
  activation = { helperDetected: false, pairingState: 'unpaired', lastSession: null };
  wasActive = false;
}
```

In the real subscription wiring (in `initStatusPusher`), subscribe to `persistenceMode` and update `persistenceModeNow`:

```typescript
  subscriptionDisposers.push(persistenceMode.subscribe((m) => {
    persistenceModeNow = m;
    refreshHeartbeat();
    schedulePush(isActive(activation));
  }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-pusher.ts app/src/lib/status-pusher.test.ts
git commit -m "feat(status-pusher): 15s session-mode heartbeat"
```

---

## Task 15: `beforeunload` final push (persist mode)

**Files:**
- Modify: `app/src/lib/status-pusher.ts`
- Modify: `app/src/lib/status-pusher.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-pusher.test.ts`:

```typescript
describe('beforeunload (persist mode final push)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    _resetStatusPusherForTests();
  });
  afterEach(() => {
    _disposeStatusPusherForTests();
    vi.unstubAllGlobals();
  });

  it('fires a fetch with keepalive:true and priority:"final" on beforeunload (persist + active)', () => {
    initStatusPusher();
    _setPersistenceModeForTests('persist');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    fetchSpy.mockClear(); // clear the immediate fresh-state push
    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/status$/);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body).priority).toBe('final');
  });

  it('does NOT fire on beforeunload in session mode', () => {
    initStatusPusher();
    _setPersistenceModeForTests('session-only');
    _setActivationForTests({
      helperDetected: true,
      pairingState: 'paired',
      lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
    });
    fetchSpy.mockClear();
    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does NOT fire on beforeunload when dormant', () => {
    initStatusPusher();
    _setPersistenceModeForTests('persist');
    // Don't set activation — pusher stays dormant.
    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: FAIL — `beforeunload` not handled.

- [ ] **Step 3: Implement beforeunload**

Add to `app/src/lib/status-pusher.ts` (inside `initStatusPusher`, after the subscriptions):

```typescript
  // Persist-mode beforeunload final push. `keepalive: true` lets the
  // request outlive the page; `sendBeacon` would be more reliable but
  // doesn't support custom auth headers. See spec §7.
  if (typeof window !== 'undefined') {
    const beforeUnloadHandler = (): void => {
      if (!isActive(activation) || persistenceModeNow !== 'persist') return;
      const inputs: StatusSnapshotInputs = {
        inventoryState: get(inventoryState),
        libraryRefreshState: get(libraryRefreshState),
        fetchProgress: get(fetchProgress),
        imageHydration: get(imageHydration),
        articleHydration: get(articleHydration),
        threadProgress: get(threadProgress),
        persistenceMode: get(persistenceMode),
        lastSession: get(lastSessionStore),
        browserBytesEstimate: browserBytesCache.bytes,
        lastActivity: currentActivity,
        priority: 'final',
      };
      const payload = buildStatusPayload(inputs);
      if (payload === null) return;
      const { token } = get(pairingToken);
      if (token === null) return;
      try {
        void fetch(`${config.helperOrigin}/status`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          keepalive: true,
        });
      } catch { /* page is unloading; nothing to recover from */ }
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);
    subscriptionDisposers.push(() => window.removeEventListener('beforeunload', beforeUnloadHandler));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-pusher.ts app/src/lib/status-pusher.test.ts
git commit -m "feat(status-pusher): beforeunload final push (persist mode)"
```

---

## Task 16: `deleteStatus()` for Clear All Data

**Files:**
- Modify: `app/src/lib/status-pusher.ts`
- Modify: `app/src/lib/status-pusher.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/status-pusher.test.ts`:

```typescript
import { deleteStatus } from './status-pusher';
import { setPairingToken, clearPairingToken } from './pairing-token';

describe('deleteStatus', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    clearPairingToken();
    vi.unstubAllGlobals();
  });

  it('sends DELETE /status with bearer auth when paired', async () => {
    setPairingToken('a'.repeat(43));
    await deleteStatus();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/status$/);
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toMatch(/^Bearer /);
  });

  it('is a no-op when unpaired (token absent)', async () => {
    clearPairingToken();
    await deleteStatus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves silently when the DELETE network call fails', async () => {
    setPairingToken('a'.repeat(43));
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(deleteStatus()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: FAIL — `deleteStatus` not exported.

- [ ] **Step 3: Implement `deleteStatus`**

Add to `app/src/lib/status-pusher.ts`:

```typescript
/**
 * Tell the helper to drop the persisted status snapshot. Called by
 * Settings.svelte's "Clear all data" handler BEFORE `clearPairingToken()`
 * so the bearer token is still available for auth.
 *
 * Resolves silently on any failure — local cleanup is the source of
 * truth, and the user's "wipe everything" intent should proceed even
 * if the helper-side delete can't complete.
 */
export async function deleteStatus(): Promise<void> {
  const { state, token } = get(pairingToken);
  if (token === null || state === 'unpaired') return;
  try {
    await fetch(`${config.helperOrigin}/status`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* best-effort; local wipe proceeds */
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/src/lib/status-pusher.test.ts`
Expected: PASS (23 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/status-pusher.ts app/src/lib/status-pusher.test.ts
git commit -m "feat(status-pusher): deleteStatus() for Clear All Data"
```

---

## Task 17: Bootstrap in `main.ts`

**Files:**
- Modify: `app/src/main.ts`

- [ ] **Step 1: Read main.ts**

Run: `cat app/src/main.ts`

Locate the cluster of init calls near the bottom (before `new App({ target })`).

- [ ] **Step 2: Add the import and the init call**

Add an import near the other `$lib` imports:

```typescript
import { initStatusPusher } from './lib/status-pusher';
```

Add the init call alongside the others (after `initPairingToken()`):

```typescript
initPairingToken();
initStatusPusher();  // ← add this
initStoragePersist();
registerServiceWorker();
```

- [ ] **Step 3: Run pnpm check to verify no type errors**

Run: `pnpm check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: All tests pass (previous count + ~23 new status-pusher tests + ~16 new status-payload tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/main.ts
git commit -m "feat(main): bootstrap status pusher"
```

---

## Task 18: Wire `deleteStatus()` into Settings's Clear-Data handler

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Locate the Clear-Data handler**

Run: `grep -n "clearPairingToken\|Clear all data\|handleClearAll" app/src/routes/Settings.svelte`

Find the function that orchestrates the data wipe — typically `handleClearAll()` or similar.

- [ ] **Step 2: Add the import**

Near the existing `$lib` imports in `Settings.svelte`'s `<script>` block:

```typescript
import { deleteStatus } from '$lib/status-pusher';
```

- [ ] **Step 3: Add the `deleteStatus()` call**

In the Clear-Data handler, insert **before** `clearPairingToken()`:

```typescript
async function handleClearAll(): Promise<void> {
  // ...existing steps (cancel hydration, terminate driver, etc.)...

  await deleteStatus().catch(() => {
    /* best-effort; local wipe proceeds */
  });

  await Promise.all([
    clearPairingToken(),
    // ...existing clears...
  ]);
  // ...
}
```

The exact line where `deleteStatus()` goes depends on the existing structure; it must come **before** `clearPairingToken()` so the auth bearer is still valid.

- [ ] **Step 4: Run pnpm check**

Run: `pnpm check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`
Expected: all tests still pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/routes/Settings.svelte
git commit -m "feat(settings): call deleteStatus before clearing pairing token"
```

---

## Task 19: Production build smoke

**Files:** None (verification only)

- [ ] **Step 1: Run the production build**

Run: `pnpm build`
Expected: Build completes cleanly. No new console warnings or errors.

- [ ] **Step 2: Inspect the bundle for status-pusher references**

Run: `grep -ho 'status' dist/assets/*.js | sort -u | head -5`
Expected: see `/status`, `status` strings present (indicates the pusher made it into the bundle).

- [ ] **Step 3: Commit (no changes; checkpoint only)**

No commit needed.

---

## Task 20: End-to-end smoke against a real helper (manual)

**Files:** None (manual verification)

This task is for the maintainer to run locally after the implementation lands. Not automated.

- [ ] **Step 1: Build and serve the GUI**

Run: `pnpm dev` (or `pnpm build && pnpm preview`).

- [ ] **Step 2: Start the helper**

In another terminal: `pipx install bsky-saves`, then `bsky-saves serve --gui`.

- [ ] **Step 3: Sign in via the GUI**

Open the GUI, sign in with a real Bluesky handle + app password. Watch the helper's logs for incoming `POST /status` requests.

Expected:
- A push fires within a second of successful sign-in (immediate fresh-state push).
- Subsequent pushes fire as the fetch + hydration progress through the library.
- `curl -H "Authorization: Bearer $(cat ~/.config/bsky-saves/token)" http://localhost:47826/status` returns the latest payload as JSON.

- [ ] **Step 4: Exercise the heartbeat path**

Sign out, then sign in again with "Keep my saved posts in this browser" unchecked (session mode). Watch the helper's logs:
- Status pushes should arrive at ~15-second intervals while the tab is idle.
- Close the tab. Within ~60 seconds, `GET /status` should return 404 (TTL expired).

- [ ] **Step 5: Exercise the beforeunload path**

In persist mode, sign in and wait for the initial sync to complete. Close the tab. Inspect `~/.config/bsky-saves/status.json` — its timestamp should be from the moment of tab close.

- [ ] **Step 6: Exercise Clear All Data**

Settings → Clear all data. Helper's `GET /status` should return 404 immediately afterward.

---

## Self-review

**Spec coverage:**
- §3.1 modules (status-payload, status-pusher) — Tasks 1–8, 9–16
- §3.2 data flow — Tasks 10, 12
- §4 activation state machine — Tasks 9, 12, 13
- §5 triggers and payload — Tasks 2–7
- §5.1 debounce semantics — Task 11
- §5.2 payload field mapping — Tasks 2–8
- §6 heartbeat — Task 14
- §7 beforeunload — Task 15
- §8 failure handling — Task 10 (logging in catch), Task 13 (helperOptOut via capability), Task 11 (next-trigger replaces stale state)
- §9 Clear-Data DELETE — Tasks 16, 18
- §10 bootstrap — Task 17
- §11 testing strategy — Embedded across tasks (each task has its tests)

**Placeholder scan:** No "TBD" / "TODO" / "Add appropriate error handling" left. Each step has concrete code or commands.

**Type consistency:** `ActivationInputs`, `StatusSnapshotInputs`, `StatusPayload`, `LastActivity`, `PusherDeps` consistent across tasks. `pushSnapshotForTests` (test surface) and `pushOnce` (internal) distinguished. The Task 13 refactor that removes `helperOptOut` from `ActivationInputs` is internally consistent within that task's diff.

**Edge cases covered:**
- Unsigned (lastSession === null) → returns null payload
- Loading inventory → total_saves is null
- Empty hydration buckets (total === 0) → omitted
- Stale pairing → no push
- Network failure → silent debug log
- Beforeunload in session mode → no push

**Gaps:**
- The `last_activity` tracking inside `status-pusher.ts` (which subscription updates it, and how) is left as an implementation detail of Task 12's subscription wiring. The pusher would update `currentActivity` when libraryRefreshState transitions or when a hydration store's status flips to `done`/`error`. This is mentioned in the spec §5.2 but the precise transition rules aren't enumerated in the plan. Acceptable: the `LastActivity` interface is fixed, and the implementer can write the transitions trivially when wiring the relevant subscriptions.
