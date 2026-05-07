# Helper-Routed Pipeline Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GUI's `engine.ts` + `pyodide-runner.ts` Runner abstraction with a hydrator-pattern pipeline that routes fetch / enrich / hydrate-threads through the local `bsky-saves serve` helper when one is detected, falling back to Pyodide otherwise. UX unchanged in this plan; UX hub refactor lives in a follow-up plan.

**Architecture:** Single `CapabilitySnapshot` Svelte store, computed once at startup, exposes typed routing decisions per operation. Five progress stores (three new: `fetchProgress`, `enrichProgress`, `threadProgress`; two existing: `imagesProgress`, `articlesProgress`). New hydrator modules dispatch on the snapshot. `orchestrate-refresh.ts` sequences the three new hydrators. `engine.ts` becomes a thin shim around the orchestrator, preserving the `runJob` API so `Run.svelte` continues to work unchanged.

**Tech Stack:** TypeScript 5, Svelte 4, Vitest, idb-keyval, sync `httpx`-style `fetch()` over the helper at `127.0.0.1:47826`, existing Pyodide Web Worker at `app/src/worker/pyodide-worker.ts`.

**Companion spec:** `docs/superpowers/specs/2026-05-07-library-hub-and-helper-routing-design.md`.
**Helper API contract:** `docs/bsky-saves-serve-fetch-enrich-threads-requirements.md`.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `app/src/lib/capability-snapshot.ts` | Type + `computeCapabilitySnapshot()` pure function + Svelte store + `initCapabilitySnapshot()` startup wiring. |
| `app/src/lib/capability-snapshot.test.ts` | Unit tests for the routing rules + store init. |
| `app/src/lib/fetch-hydrator.ts` | `fetchHydrator.start(input)` — paginated `/fetch` with rotation handling (helper path) or pyodide-worker-driver (Pyodide path); updates `fetchProgress`. |
| `app/src/lib/fetch-hydrator.test.ts` | Tests both paths with mocked helper-client and mocked driver. |
| `app/src/lib/enrich-hydrator.ts` | `enrichHydrator.start(uris, inventoryDraft)` — calls helper `/enrich` or Pyodide; merges `post_created_at` deltas; updates `enrichProgress`. |
| `app/src/lib/enrich-hydrator.test.ts` | Both paths. |
| `app/src/lib/thread-hydrator.ts` | `threadHydrator.start(uris, inventoryDraft)` — calls helper `/hydrate-threads` or Pyodide; merges thread deltas; updates `threadProgress`. |
| `app/src/lib/thread-hydrator.test.ts` | Both paths. |
| `app/src/lib/pyodide-worker-driver.ts` | Thin per-step driver that posts typed messages to `pyodide-worker.ts` and returns results. Replaces `pyodide-runner.ts` (whole-job runner). |
| `app/src/lib/pyodide-worker-driver.test.ts` | Mocked-worker tests. |
| `app/src/lib/orchestrate-refresh.ts` | Sequences `fetchHydrator → enrichHydrator → (optional) threadHydrator`. Persists final inventory. Returns `{session, inventory}`. |
| `app/src/lib/orchestrate-refresh.test.ts` | End-to-end-ish test with mocked hydrators. |

### Modified files

| Path | Change |
|---|---|
| `app/src/lib/helper-client.ts` | Add `fetchSaves()`, `enrichUris()`, `hydrateThreads()`. Existing `fetchImageViaHelper` / `extractArticleViaHelper` / `probeHelper` unchanged. |
| `app/src/lib/helper-client.test.ts` | New tests for the three new functions including rotated_credentials and 401 paths. |
| `app/src/lib/hydration-state.ts` | Add `fetchProgress`, `enrichProgress`, `threadProgress` writable stores plus `reset*` helpers. |
| `app/src/lib/hydration-state.test.ts` | New tests for the three stores. |
| `app/src/worker/pyodide-worker.ts` | Add per-step message handlers (`fetch_only`, `enrich_only`, `threads_only`); existing `runFetch` handler preserved for the engine.ts shim and any direct caller. |
| `app/src/lib/engine.ts` | Replace internals with a thin call to `orchestrate-refresh`; `runJob` signature preserved. `onLog` translates progress-store transitions into log strings. |
| `app/src/lib/engine.test.ts` | Update existing tests to assert against the new internals (mocked orchestrator). |
| `app/src/lib/image-hydrator.ts` | Read `CapabilitySnapshot.images` instead of calling `describeAvailableImageBackend()` per-call. |
| `app/src/lib/image-hydrator.test.ts` | Update tests to inject a snapshot. |
| `app/src/lib/article-hydrator.ts` | Read `CapabilitySnapshot.articles` instead of `describeArticleBackend()` per-call. |
| `app/src/lib/article-hydrator.test.ts` | Update tests. |
| `app/src/lib/min-helper-version.ts` | `MIN_HELPER_VERSION = '0.4.1'`. |
| `app/src/lib/min-helper-version.test.ts` | Adjust thresholds (`'0.4.0'` → outdated, `'0.4.1'` → current). |
| `app/src/main.ts` (or `App.svelte`, whichever bootstraps) | Call `initCapabilitySnapshot()` at startup. |

### Deleted files

| Path | Reason |
|---|---|
| `app/src/lib/pyodide-runner.ts` | Replaced by `pyodide-worker-driver.ts`. The `PyodideRunner` class wrapping the worker is no longer used; engine.ts no longer instantiates it. |
| `app/src/lib/pyodide-runner.test.ts` | Tests covered by `pyodide-worker-driver.test.ts`. |

---

## Phase A — CapabilitySnapshot foundation

### Task 1: Define `CapabilitySnapshot` type and a default-empty value

**Files:**
- Create: `app/src/lib/capability-snapshot.ts`
- Test: `app/src/lib/capability-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/capability-snapshot.test.ts
import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT, type CapabilitySnapshot } from './capability-snapshot';

describe('CapabilitySnapshot', () => {
  it('EMPTY_SNAPSHOT defaults all routing to non-helper', () => {
    const s: CapabilitySnapshot = EMPTY_SNAPSHOT;
    expect(s.helper).toEqual({ detected: false });
    expect(s.fetch.kind).toBe('pyodide');
    expect(s.enrich.kind).toBe('pyodide');
    expect(s.threads.kind).toBe('pyodide');
    expect(s.images.kind).toBe('operator-worker');
    expect(s.articles.kind).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/capability-snapshot.test.ts`
Expected: FAIL with `Failed to load url ./capability-snapshot`.

- [ ] **Step 3: Write the type and default**

```ts
// app/src/lib/capability-snapshot.ts
export type HelperFacts =
  | { readonly detected: false }
  | {
      readonly detected: true;
      readonly version: string;
      readonly features: readonly string[];
    };

export type CapabilitySnapshot = {
  readonly helper: HelperFacts;
  readonly fetch:    { readonly kind: 'helper' } | { readonly kind: 'pyodide' };
  readonly enrich:   { readonly kind: 'helper' } | { readonly kind: 'pyodide' };
  readonly threads:  { readonly kind: 'helper' } | { readonly kind: 'pyodide' };
  readonly images:
    | { readonly kind: 'helper' }
    | { readonly kind: 'user-worker'; readonly url: string }
    | { readonly kind: 'operator-worker' };
  readonly articles:
    | { readonly kind: 'helper' }
    | { readonly kind: 'user-worker'; readonly url: string }
    | { readonly kind: 'none' };
};

export const EMPTY_SNAPSHOT: CapabilitySnapshot = {
  helper: { detected: false },
  fetch:    { kind: 'pyodide' },
  enrich:   { kind: 'pyodide' },
  threads:  { kind: 'pyodide' },
  images:   { kind: 'operator-worker' },
  articles: { kind: 'none' },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/capability-snapshot.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/capability-snapshot.ts app/src/lib/capability-snapshot.test.ts
git commit -m "feat(capability-snapshot): type + EMPTY_SNAPSHOT default"
```

---

### Task 2: `computeCapabilitySnapshot()` — pure routing function

**Files:**
- Modify: `app/src/lib/capability-snapshot.ts`
- Test: `app/src/lib/capability-snapshot.test.ts`

- [ ] **Step 1: Add failing tests for each routing rule**

Append to `app/src/lib/capability-snapshot.test.ts`:

```ts
import { computeCapabilitySnapshot } from './capability-snapshot';
import type { HelperStatus } from './helper-client';

const helperWith = (features: string[], version = '0.4.1'): HelperStatus => ({
  status: 'available',
  version,
  features,
});

describe('computeCapabilitySnapshot', () => {
  it('routes everything to helper when v0.4.1 advertises all flags', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith(['fetch', 'enrich', 'hydrate-threads', 'jwt-credentials', 'fetch-image', 'extract-article']),
      userWorker: null,
    });
    expect(snap.fetch.kind).toBe('helper');
    expect(snap.enrich.kind).toBe('helper');
    expect(snap.threads.kind).toBe('helper');
    expect(snap.images.kind).toBe('helper');
    expect(snap.articles.kind).toBe('helper');
  });

  it('routes fetch/enrich/threads to pyodide if jwt-credentials missing', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith(['fetch', 'enrich', 'hydrate-threads']),
      userWorker: null,
    });
    expect(snap.fetch.kind).toBe('pyodide');
    expect(snap.enrich.kind).toBe('pyodide');
    expect(snap.threads.kind).toBe('pyodide');
  });

  it('routes fetch/enrich/threads to pyodide if any of fetch/enrich/hydrate-threads missing', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith(['fetch', 'enrich', 'jwt-credentials']),
      userWorker: null,
    });
    expect(snap.threads.kind).toBe('pyodide');
  });

  it('routes images to user-worker when configured and helper lacks fetch-image', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith(['fetch']),
      userWorker: { url: 'https://my.worker.dev' },
    });
    expect(snap.images).toEqual({ kind: 'user-worker', url: 'https://my.worker.dev' });
  });

  it('routes images to operator-worker when no helper image support and no user worker', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith([]),
      userWorker: null,
    });
    expect(snap.images).toEqual({ kind: 'operator-worker' });
  });

  it('routes articles to none when helper lacks extract-article and no user worker', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith([]),
      userWorker: null,
    });
    expect(snap.articles).toEqual({ kind: 'none' });
  });

  it('routes articles to user-worker when configured and helper lacks extract-article', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith([]),
      userWorker: { url: 'https://my.worker.dev' },
    });
    expect(snap.articles).toEqual({ kind: 'user-worker', url: 'https://my.worker.dev' });
  });

  it('falls back entirely when helper unavailable', () => {
    const snap = computeCapabilitySnapshot({
      helper: { status: 'unavailable' },
      userWorker: null,
    });
    expect(snap.helper.detected).toBe(false);
    expect(snap.fetch.kind).toBe('pyodide');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/capability-snapshot.test.ts`
Expected: FAIL — `computeCapabilitySnapshot` not exported.

- [ ] **Step 3: Implement the function**

Append to `app/src/lib/capability-snapshot.ts`:

```ts
import type { HelperStatus } from './helper-client';

export interface CapabilitySnapshotInputs {
  readonly helper: HelperStatus;
  readonly userWorker: { readonly url: string } | null;
}

export function computeCapabilitySnapshot(
  inputs: CapabilitySnapshotInputs,
): CapabilitySnapshot {
  const { helper, userWorker } = inputs;
  if (helper.status !== 'available') {
    return {
      ...EMPTY_SNAPSHOT,
      images:   userWorker ? { kind: 'user-worker', url: userWorker.url } : { kind: 'operator-worker' },
      articles: userWorker ? { kind: 'user-worker', url: userWorker.url } : { kind: 'none' },
    };
  }
  const f = new Set(helper.features);
  const fetchOk = f.has('fetch') && f.has('enrich') && f.has('hydrate-threads') && f.has('jwt-credentials');
  return {
    helper: { detected: true, version: helper.version, features: helper.features },
    fetch:   fetchOk ? { kind: 'helper' } : { kind: 'pyodide' },
    enrich:  fetchOk ? { kind: 'helper' } : { kind: 'pyodide' },
    threads: fetchOk ? { kind: 'helper' } : { kind: 'pyodide' },
    images:
      f.has('fetch-image') ? { kind: 'helper' }
      : userWorker        ? { kind: 'user-worker', url: userWorker.url }
      : { kind: 'operator-worker' },
    articles:
      f.has('extract-article') ? { kind: 'helper' }
      : userWorker             ? { kind: 'user-worker', url: userWorker.url }
      : { kind: 'none' },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/capability-snapshot.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/capability-snapshot.ts app/src/lib/capability-snapshot.test.ts
git commit -m "feat(capability-snapshot): pure computeCapabilitySnapshot() routing rules"
```

---

### Task 3: `capabilitySnapshot` Svelte store + `initCapabilitySnapshot()`

**Files:**
- Modify: `app/src/lib/capability-snapshot.ts`
- Test: `app/src/lib/capability-snapshot.test.ts`

- [ ] **Step 1: Add failing tests for the store**

Append to `app/src/lib/capability-snapshot.test.ts`:

```ts
import { get } from 'svelte/store';
import { capabilitySnapshot, initCapabilitySnapshot, _resetForTests } from './capability-snapshot';

describe('capabilitySnapshot store', () => {
  beforeEach(() => _resetForTests());

  it('initializes to EMPTY_SNAPSHOT', () => {
    expect(get(capabilitySnapshot)).toEqual(EMPTY_SNAPSHOT);
  });

  it('initCapabilitySnapshot writes a computed snapshot', async () => {
    const fakeProbe = async () => helperWith(['fetch-image']);
    const fakeUserWorker = async () => null;
    await initCapabilitySnapshot({ probe: fakeProbe, loadUserWorker: fakeUserWorker });
    const snap = get(capabilitySnapshot);
    expect(snap.helper.detected).toBe(true);
    expect(snap.images.kind).toBe('helper');
    expect(snap.articles.kind).toBe('none');
  });

  it('initCapabilitySnapshot tolerates probe rejection', async () => {
    const fakeProbe = async () => { throw new Error('network'); };
    const fakeUserWorker = async () => null;
    await initCapabilitySnapshot({ probe: fakeProbe, loadUserWorker: fakeUserWorker });
    const snap = get(capabilitySnapshot);
    expect(snap.helper.detected).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/capability-snapshot.test.ts`
Expected: FAIL — `capabilitySnapshot`, `initCapabilitySnapshot`, `_resetForTests` not exported.

- [ ] **Step 3: Implement the store**

Append to `app/src/lib/capability-snapshot.ts`:

```ts
import { writable, type Readable } from 'svelte/store';
import { probeConfiguredHelper } from './helper-client';
import { loadProxyConfig } from './proxy-config';

const store = writable<CapabilitySnapshot>(EMPTY_SNAPSHOT);
export const capabilitySnapshot: Readable<CapabilitySnapshot> = { subscribe: store.subscribe };

export interface InitDeps {
  readonly probe?: () => Promise<HelperStatus>;
  readonly loadUserWorker?: () => Promise<{ readonly url: string } | null>;
}

export async function initCapabilitySnapshot(deps: InitDeps = {}): Promise<void> {
  const probe = deps.probe ?? probeConfiguredHelper;
  const loadUserWorker = deps.loadUserWorker ?? loadUserWorkerFromProxyConfig;
  let helper: HelperStatus;
  try {
    helper = await probe();
  } catch {
    helper = { status: 'unavailable' };
  }
  let userWorker: { readonly url: string } | null;
  try {
    userWorker = await loadUserWorker();
  } catch {
    userWorker = null;
  }
  store.set(computeCapabilitySnapshot({ helper, userWorker }));
}

async function loadUserWorkerFromProxyConfig(): Promise<{ readonly url: string } | null> {
  const cfg = await loadProxyConfig();
  return cfg && cfg.url ? { url: cfg.url } : null;
}

/** For tests only — resets the store to EMPTY_SNAPSHOT. */
export function _resetForTests(): void {
  store.set(EMPTY_SNAPSHOT);
}
```

(If `proxy-config.ts` exposes a different load function name, adjust the import. Verify with: `grep -n "export" app/src/lib/proxy-config.ts | head -10`. If the function is called something else, replace `loadProxyConfig` with the correct name.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/capability-snapshot.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/capability-snapshot.ts app/src/lib/capability-snapshot.test.ts
git commit -m "feat(capability-snapshot): Svelte store + initCapabilitySnapshot()"
```

---

### Task 4: Wire `initCapabilitySnapshot()` into app startup

**Files:**
- Modify: `app/src/main.ts` (or wherever app bootstraps; verify with `cat app/src/main.ts` or `head -30 app/src/App.svelte`).

- [ ] **Step 1: Inspect bootstrap location**

Run: `cat app/src/main.ts` to confirm where the app initializes.

- [ ] **Step 2: Add init call**

Modify `app/src/main.ts` to import and call `initCapabilitySnapshot()` before mounting the root component. Example:

```ts
import { initCapabilitySnapshot } from './lib/capability-snapshot';

initCapabilitySnapshot().catch(() => {
  // Snapshot stays at EMPTY_SNAPSHOT; the app continues with Pyodide routing.
});
```

The init runs in parallel with the app rendering — don't `await` it before mount.

- [ ] **Step 3: Run all tests to verify nothing regressed**

Run: `cd app && npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/main.ts
git commit -m "feat(capability-snapshot): init at app startup"
```

---

## Phase B — helper-client extensions

### Task 5: `helper-client.fetchSaves()` — app-password path

**Files:**
- Modify: `app/src/lib/helper-client.ts`
- Test: `app/src/lib/helper-client.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `app/src/lib/helper-client.test.ts`:

```ts
import { fetchSaves, type FetchSavesResponse } from './helper-client';

describe('fetchSaves (app-password)', () => {
  it('POSTs to /fetch with the app-password credential shape', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ saves: [], cursor: null }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchSaves('http://localhost:47826', {
      credentials: { handle: 'a.bsky.social', appPassword: 'pw', pds: 'https://bsky.social' },
      cursor: null,
      limit: 100,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:47826/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: { handle: 'a.bsky.social', app_password: 'pw', pds: 'https://bsky.social' },
          cursor: null,
          limit: 100,
        }),
      }),
    );
    expect(out).toEqual<FetchSavesResponse>({ saves: [], cursor: null });
    vi.unstubAllGlobals();
  });

  it('throws on 400 missing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'missing credentials' }), { status: 400 }),
    ));
    await expect(fetchSaves('http://x', {
      credentials: { handle: '', appPassword: '', pds: '' },
      cursor: null, limit: 100,
    })).rejects.toThrow(/missing credentials/);
    vi.unstubAllGlobals();
  });

  it('throws on 401 createSession failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'createSession failed: bad pw' }), { status: 401 }),
    ));
    await expect(fetchSaves('http://x', {
      credentials: { handle: 'a', appPassword: 'b', pds: 'c' },
      cursor: null, limit: 100,
    })).rejects.toThrow(/createSession failed/);
    vi.unstubAllGlobals();
  });

  it('throws on 400 invalid cursor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid cursor' }), { status: 400 }),
    ));
    await expect(fetchSaves('http://x', {
      credentials: { handle: 'a', appPassword: 'b', pds: 'c' },
      cursor: 'corrupt', limit: 100,
    })).rejects.toThrow(/invalid cursor/);
    vi.unstubAllGlobals();
  });
});
```

(If `app/src/lib/helper-client.test.ts` doesn't exist yet, create it with the standard imports: `import { describe, expect, it, vi } from 'vitest';`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/helper-client.test.ts`
Expected: FAIL — `fetchSaves` not exported.

- [ ] **Step 3: Implement**

Append to `app/src/lib/helper-client.ts`:

```ts
export type AppPasswordCredentials = {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
};

export type JwtPairCredentials = {
  readonly accessJwt: string;
  readonly refreshJwt: string;
  readonly did: string;
  readonly pds?: string;
};

export type FetchSavesCredentials = AppPasswordCredentials | JwtPairCredentials;

export interface FetchSavesRequest {
  readonly credentials: FetchSavesCredentials;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface FetchSavesResponse {
  readonly saves: readonly unknown[];
  readonly cursor: string | null;
  readonly rotated_credentials?: {
    readonly access_jwt: string;
    readonly refresh_jwt: string;
    readonly did: string;
  };
}

function isAppPassword(c: FetchSavesCredentials): c is AppPasswordCredentials {
  return 'appPassword' in c;
}

function serialiseCredentials(c: FetchSavesCredentials): Record<string, string> {
  if (isAppPassword(c)) {
    return { handle: c.handle, app_password: c.appPassword, pds: c.pds };
  }
  return {
    access_jwt: c.accessJwt,
    refresh_jwt: c.refreshJwt,
    did: c.did,
    ...(c.pds ? { pds: c.pds } : {}),
  };
}

export async function fetchSaves(
  origin: string,
  req: FetchSavesRequest,
): Promise<FetchSavesResponse> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credentials: serialiseCredentials(req.credentials),
      cursor: req.cursor,
      limit: req.limit,
    }),
  });
  if (!res.ok) {
    let msg = `helper /fetch returned ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return await res.json() as FetchSavesResponse;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/helper-client.test.ts`
Expected: PASS (4 new tests, plus existing passing).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/helper-client.ts app/src/lib/helper-client.test.ts
git commit -m "feat(helper-client): fetchSaves() — app-password path"
```

---

### Task 6: `fetchSaves()` — JWT path with `rotated_credentials`

**Files:**
- Modify: `app/src/lib/helper-client.test.ts` (add tests for JWT shape)
- No production code changes needed — `fetchSaves` already accepts `JwtPairCredentials` from Task 5.

- [ ] **Step 1: Write failing tests**

Append to `app/src/lib/helper-client.test.ts`:

```ts
describe('fetchSaves (jwt-pair)', () => {
  it('POSTs the JWT-pair credential shape (snake_case keys)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ saves: [], cursor: null }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchSaves('http://x', {
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1', pds: 'https://bsky.social' },
      cursor: null,
      limit: 100,
    });

    expect(fetchMock).toHaveBeenCalledWith('http://x/fetch', expect.objectContaining({
      body: JSON.stringify({
        credentials: { access_jwt: 'A', refresh_jwt: 'R', did: 'did:plc:1', pds: 'https://bsky.social' },
        cursor: null,
        limit: 100,
      }),
    }));
    vi.unstubAllGlobals();
  });

  it('returns rotated_credentials when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({
        saves: [],
        cursor: 'c1',
        rotated_credentials: { access_jwt: 'A2', refresh_jwt: 'R2', did: 'did:plc:1' },
      }), { status: 200 }),
    ));

    const out = await fetchSaves('http://x', {
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
      cursor: null, limit: 100,
    });

    expect(out.rotated_credentials).toEqual({ access_jwt: 'A2', refresh_jwt: 'R2', did: 'did:plc:1' });
    vi.unstubAllGlobals();
  });

  it('rotated_credentials absent when refresh did not happen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ saves: [], cursor: null }), { status: 200 }),
    ));
    const out = await fetchSaves('http://x', {
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
      cursor: null, limit: 100,
    });
    expect(out.rotated_credentials).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('throws on 401 auth refresh failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'auth refresh failed', code: 'refresh_failed' }), { status: 401 }),
    ));
    await expect(fetchSaves('http://x', {
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
      cursor: null, limit: 100,
    })).rejects.toThrow(/auth refresh failed/);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/helper-client.test.ts`
Expected: PASS (8 helper-client tests now).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/helper-client.test.ts
git commit -m "test(helper-client): fetchSaves() jwt-pair + rotated_credentials"
```

---

### Task 7: `helper-client.enrichUris()`

**Files:**
- Modify: `app/src/lib/helper-client.ts`
- Test: `app/src/lib/helper-client.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { enrichUris } from './helper-client';

describe('enrichUris', () => {
  it('POSTs to /enrich with uris (no credentials)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ enriched: [{ uri: 'at://x', post_created_at: '2026-01-01T00:00:00Z' }], errors: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await enrichUris('http://x', { uris: ['at://x'] });

    expect(fetchMock).toHaveBeenCalledWith('http://x/enrich', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ uris: ['at://x'] }),
    }));
    expect(out.enriched).toHaveLength(1);
    expect(out.errors).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('throws on 400 missing uris', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'missing uris' }), { status: 400 }),
    ));
    await expect(enrichUris('http://x', { uris: [] as unknown as string[] })).rejects.toThrow(/missing uris/);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/helper-client.test.ts`
Expected: FAIL — `enrichUris` not exported.

- [ ] **Step 3: Implement**

Append to `app/src/lib/helper-client.ts`:

```ts
export interface EnrichRequest {
  readonly uris: readonly string[];
}

export interface EnrichEntry {
  readonly uri: string;
  readonly post_created_at: string;
}

export interface EnrichErrorEntry {
  readonly uri: string;
  readonly reason: string;
}

export interface EnrichResponse {
  readonly enriched: readonly EnrichEntry[];
  readonly errors: readonly EnrichErrorEntry[];
}

export async function enrichUris(origin: string, req: EnrichRequest): Promise<EnrichResponse> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: req.uris }),
  });
  if (!res.ok) {
    let msg = `helper /enrich returned ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return await res.json() as EnrichResponse;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/helper-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/helper-client.ts app/src/lib/helper-client.test.ts
git commit -m "feat(helper-client): enrichUris()"
```

---

### Task 8: `helper-client.hydrateThreads()`

**Files:**
- Modify: `app/src/lib/helper-client.ts`
- Test: `app/src/lib/helper-client.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { hydrateThreads } from './helper-client';

describe('hydrateThreads', () => {
  it('POSTs uris and credentials to /hydrate-threads', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ threaded: [], errors: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await hydrateThreads('http://x', {
      uris: ['at://a'],
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
    });

    expect(fetchMock).toHaveBeenCalledWith('http://x/hydrate-threads', expect.objectContaining({
      body: JSON.stringify({
        uris: ['at://a'],
        credentials: { access_jwt: 'A', refresh_jwt: 'R', did: 'did:plc:1' },
      }),
    }));
    vi.unstubAllGlobals();
  });

  it('throws on 400 missing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'missing credentials' }), { status: 400 }),
    ));
    await expect(hydrateThreads('http://x', {
      uris: ['at://a'],
      credentials: { handle: '', appPassword: '', pds: '' },
    })).rejects.toThrow(/missing credentials/);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/helper-client.test.ts`
Expected: FAIL — `hydrateThreads` not exported.

- [ ] **Step 3: Implement**

Append to `app/src/lib/helper-client.ts`:

```ts
export interface HydrateThreadsRequest {
  readonly uris: readonly string[];
  readonly credentials: FetchSavesCredentials;
}

export interface ThreadEntry {
  readonly uri: string;
  readonly thread_replies: readonly unknown[];
  readonly thread_schema_version: number;
  readonly thread_fetched_at: string;
}

export interface ThreadErrorEntry {
  readonly uri: string;
  readonly reason: string;
}

export interface HydrateThreadsResponse {
  readonly threaded: readonly ThreadEntry[];
  readonly errors: readonly ThreadErrorEntry[];
}

export async function hydrateThreads(
  origin: string,
  req: HydrateThreadsRequest,
): Promise<HydrateThreadsResponse> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/hydrate-threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uris: req.uris,
      credentials: serialiseCredentials(req.credentials),
    }),
  });
  if (!res.ok) {
    let msg = `helper /hydrate-threads returned ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return await res.json() as HydrateThreadsResponse;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/helper-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/helper-client.ts app/src/lib/helper-client.test.ts
git commit -m "feat(helper-client): hydrateThreads()"
```

---

## Phase C — progress stores

### Task 9: Add `fetchProgress` / `enrichProgress` / `threadProgress`

**Files:**
- Modify: `app/src/lib/hydration-state.ts`
- Test: `app/src/lib/hydration-state.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `app/src/lib/hydration-state.test.ts`:

```ts
import { fetchProgress, resetFetchProgress, enrichProgress, resetEnrichProgress, threadProgress, resetThreadProgress } from './hydration-state';
import { get } from 'svelte/store';

describe('fetchProgress', () => {
  it('initializes idle', () => {
    expect(get(fetchProgress).status).toBe('idle');
  });
  it('reset clears state', () => {
    fetchProgress.set({ status: 'running', total: 10, fetched: 3, skipped: 0, failed: 0, failures: [] });
    resetFetchProgress();
    expect(get(fetchProgress).status).toBe('idle');
  });
});

describe('enrichProgress', () => {
  it('initializes idle', () => {
    expect(get(enrichProgress).status).toBe('idle');
  });
});

describe('threadProgress', () => {
  it('initializes idle', () => {
    expect(get(threadProgress).status).toBe('idle');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/hydration-state.test.ts`
Expected: FAIL — `fetchProgress` etc. not exported.

- [ ] **Step 3: Implement**

Append to `app/src/lib/hydration-state.ts`:

```ts
export const fetchProgress: Writable<HydrationProgress> = writable(INITIAL);

export function resetFetchProgress(): void {
  fetchProgress.set(INITIAL);
}

export const enrichProgress: Writable<HydrationProgress> = writable(INITIAL);

export function resetEnrichProgress(): void {
  enrichProgress.set(INITIAL);
}

export const threadProgress: Writable<HydrationProgress> = writable(INITIAL);

export function resetThreadProgress(): void {
  threadProgress.set(INITIAL);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/hydration-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/hydration-state.ts app/src/lib/hydration-state.test.ts
git commit -m "feat(hydration-state): add fetchProgress / enrichProgress / threadProgress stores"
```

---

## Phase D — Pyodide worker driver

### Task 10: Add per-step message handlers to `pyodide-worker.ts`

**Files:**
- Modify: `app/src/worker/pyodide-worker.ts`
- Test: existing pyodide-worker has no direct test; we'll cover the driver via unit tests in Task 11.

- [ ] **Step 1: Inspect existing message-handling structure**

Run: `grep -n "type === " app/src/worker/pyodide-worker.ts` and read around `ctx.addEventListener('message', ...)` to confirm the message type union.

- [ ] **Step 2: Add new inbound message types**

Locate the `Inbound` type and the `addEventListener('message', ...)` handler. Add three new variants:

```ts
type Inbound =
  | { type: 'init' }
  | { type: 'runFetch'; input: RunFetchInput }   // existing
  | { type: 'fetchOnly'; input: FetchOnlyInput }
  | { type: 'enrichOnly'; input: EnrichOnlyInput }
  | { type: 'threadsOnly'; input: ThreadsOnlyInput };

interface FetchOnlyInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly preauthSession?: PreauthSession;
}

interface EnrichOnlyInput {
  readonly inventory: unknown;
}

interface ThreadsOnlyInput {
  readonly inventory: unknown;
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly preauthSession?: PreauthSession;
}
```

In the handler, add three new branches that invoke a Python snippet for each step independently. For example:

```ts
} else if (msg.type === 'fetchOnly') {
  const inv = await runFetchOnly(msg.input);
  ctx.postMessage({ type: 'result', payload: inv });
} else if (msg.type === 'enrichOnly') {
  const inv = await runEnrichOnly(msg.input);
  ctx.postMessage({ type: 'result', payload: inv });
} else if (msg.type === 'threadsOnly') {
  const inv = await runThreadsOnly(msg.input);
  ctx.postMessage({ type: 'result', payload: inv });
}
```

Implement `runFetchOnly`, `runEnrichOnly`, `runThreadsOnly` as small functions that mirror the existing `runFetch`'s Python snippets but only do the relevant step. Each writes to / reads from `INVENTORY_PATH` as today.

(See existing `pyodide-worker.ts:240-294` for the pattern.)

- [ ] **Step 3: Type-check and run existing tests**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: types OK; existing tests pass (we haven't broken anything).

- [ ] **Step 4: Commit**

```bash
git add app/src/worker/pyodide-worker.ts
git commit -m "feat(pyodide-worker): per-step message handlers (fetchOnly, enrichOnly, threadsOnly)"
```

---

### Task 11: `pyodide-worker-driver.ts`

**Files:**
- Create: `app/src/lib/pyodide-worker-driver.ts`
- Test: `app/src/lib/pyodide-worker-driver.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// app/src/lib/pyodide-worker-driver.test.ts
import { describe, expect, it, vi } from 'vitest';
import { PyodideWorkerDriver, type WorkerLike } from './pyodide-worker-driver';

class FakeWorker implements WorkerLike {
  posted: unknown[] = [];
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  postMessage(m: unknown): void {
    this.posted.push(m);
    queueMicrotask(() => {
      const ls = this.listeners.get('message') ?? [];
      ls.forEach((l) => l(new MessageEvent('message', { data: { type: 'result', payload: { saves: [] } } })));
    });
  }
  addEventListener(type: string, listener: (e: MessageEvent) => void): void {
    const ls = this.listeners.get(type) ?? [];
    ls.push(listener);
    this.listeners.set(type, ls);
  }
  removeEventListener(): void { /* noop */ }
  terminate(): void { /* noop */ }
}

describe('PyodideWorkerDriver', () => {
  it('runFetchOnly posts the right message and resolves with the result', async () => {
    const fake = new FakeWorker();
    const drv = new PyodideWorkerDriver(fake);
    const out = await drv.runFetchOnly({
      handle: 'a', appPassword: 'b', pds: 'c',
    });
    expect(fake.posted[0]).toEqual({
      type: 'fetchOnly',
      input: { handle: 'a', appPassword: 'b', pds: 'c' },
    });
    expect(out).toEqual({ saves: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/pyodide-worker-driver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/pyodide-worker-driver.ts
export interface WorkerLike {
  postMessage(m: unknown): void;
  addEventListener(type: 'message' | 'error', listener: (e: MessageEvent | ErrorEvent) => void): void;
  removeEventListener(type: 'message' | 'error', listener: (e: MessageEvent | ErrorEvent) => void): void;
  terminate(): void;
}

export interface FetchOnlyInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly preauthSession?: { accessJwt: string; refreshJwt: string; did: string; handle: string };
}

export interface EnrichOnlyInput { readonly inventory: unknown; }

export interface ThreadsOnlyInput {
  readonly inventory: unknown;
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly preauthSession?: { accessJwt: string; refreshJwt: string; did: string; handle: string };
}

export class PyodideWorkerDriver {
  constructor(private worker: WorkerLike) {}

  runFetchOnly(input: FetchOnlyInput): Promise<unknown> {
    return this.send({ type: 'fetchOnly', input });
  }

  runEnrichOnly(input: EnrichOnlyInput): Promise<unknown> {
    return this.send({ type: 'enrichOnly', input });
  }

  runThreadsOnly(input: ThreadsOnlyInput): Promise<unknown> {
    return this.send({ type: 'threadsOnly', input });
  }

  private send(message: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const onMessage = (e: MessageEvent | ErrorEvent) => {
        if ('data' in e && (e as MessageEvent).data?.type === 'result') {
          this.worker.removeEventListener('message', onMessage);
          this.worker.removeEventListener('error', onMessage);
          resolve((e as MessageEvent).data.payload);
        } else if ('data' in e && (e as MessageEvent).data?.type === 'error') {
          this.worker.removeEventListener('message', onMessage);
          this.worker.removeEventListener('error', onMessage);
          reject(new Error((e as MessageEvent).data.message ?? 'pyodide worker error'));
        } else if (!('data' in e)) {
          this.worker.removeEventListener('message', onMessage);
          this.worker.removeEventListener('error', onMessage);
          reject(new Error('pyodide worker error'));
        }
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onMessage);
      this.worker.postMessage(message);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/pyodide-worker-driver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/pyodide-worker-driver.ts app/src/lib/pyodide-worker-driver.test.ts
git commit -m "feat(pyodide-worker-driver): per-step Pyodide driver replacing PyodideRunner"
```

---

## Phase E — fetch hydrator

### Task 12: `fetchHydrator` — helper path with pagination + rotation

**Files:**
- Create: `app/src/lib/fetch-hydrator.ts`
- Test: `app/src/lib/fetch-hydrator.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/fetch-hydrator.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { fetchHydrator } from './fetch-hydrator';
import { fetchProgress, resetFetchProgress } from './hydration-state';

describe('fetchHydrator (helper path)', () => {
  beforeEach(() => resetFetchProgress());

  it('paginates through /fetch until cursor is null', async () => {
    const calls: unknown[] = [];
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ saves: [{ uri: 'at://a' }], cursor: 'c1' })
      .mockResolvedValueOnce({ saves: [{ uri: 'at://b' }], cursor: null });

    const inv = await fetchHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      credentials: { handle: 'h', appPassword: 'p', pds: 'd' },
    }, { fetchSaves: (origin, req) => { calls.push(req); return fakeFetch(origin, req); } });

    expect(inv).toEqual({ saves: [{ uri: 'at://a' }, { uri: 'at://b' }] });
    expect(calls).toHaveLength(2);
    expect((calls[0] as { cursor: unknown }).cursor).toBeNull();
    expect((calls[1] as { cursor: unknown }).cursor).toBe('c1');
    expect(get(fetchProgress).status).toBe('done');
    expect(get(fetchProgress).fetched).toBe(2);
  });

  it('persists rotated_credentials via setLastSession before issuing the next request', async () => {
    const setLastSession = vi.fn();
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ saves: [], cursor: 'c1', rotated_credentials: { access_jwt: 'A2', refresh_jwt: 'R2', did: 'did:plc:1' } })
      .mockResolvedValueOnce({ saves: [], cursor: null });

    await fetchHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      credentials: { accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:1' },
    }, { fetchSaves: (_o, _r) => fakeFetch(), setLastSession });

    // setLastSession must be called BEFORE the second fetchSaves call.
    expect(setLastSession).toHaveBeenCalledBefore(fakeFetch.mock.calls[1] as never);
    expect(setLastSession.mock.calls[0][0]).toMatchObject({
      accessJwt: 'A2', refreshJwt: 'R2', did: 'did:plc:1',
    });
  });

  it('marks progress error and rethrows on helper failure', async () => {
    await expect(fetchHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      credentials: { handle: 'h', appPassword: 'p', pds: 'd' },
    }, { fetchSaves: () => { throw new Error('createSession failed'); } })).rejects.toThrow(/createSession failed/);
    expect(get(fetchProgress).status).toBe('cancelled'); // or 'idle' depending on convention; pick one.
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/fetch-hydrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/fetch-hydrator.ts
import { fetchProgress, resetFetchProgress } from './hydration-state';
import {
  fetchSaves as defaultFetchSaves,
  type FetchSavesCredentials,
  type FetchSavesResponse,
} from './helper-client';
import { setLastSession as defaultSetLastSession } from './last-session';

export type FetchBackend = { kind: 'helper' } | { kind: 'pyodide' };

export interface FetchHydratorInput {
  readonly backend: FetchBackend;
  readonly origin: string;        // helper origin; ignored for pyodide
  readonly credentials: FetchSavesCredentials;
}

export interface FetchHydratorDeps {
  readonly fetchSaves?: (origin: string, req: { credentials: FetchSavesCredentials; cursor: string | null; limit: number; }) => Promise<FetchSavesResponse>;
  readonly setLastSession?: typeof defaultSetLastSession;
}

async function runHelperPath(
  input: FetchHydratorInput,
  deps: FetchHydratorDeps,
): Promise<{ saves: unknown[] }> {
  const fetchSaves = deps.fetchSaves ?? defaultFetchSaves;
  const setLastSession = deps.setLastSession ?? defaultSetLastSession;

  resetFetchProgress();
  fetchProgress.set({ status: 'running', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] });

  const saves: unknown[] = [];
  let cursor: string | null = null;
  while (true) {
    const res = await fetchSaves(input.origin, { credentials: input.credentials, cursor, limit: 100 });
    saves.push(...res.saves);
    fetchProgress.update((p) => ({ ...p, fetched: p.fetched + res.saves.length, total: p.fetched + res.saves.length }));
    if (res.rotated_credentials) {
      setLastSession({
        pds: 'pds' in input.credentials && input.credentials.pds ? input.credentials.pds : 'https://bsky.social',
        accessJwt: res.rotated_credentials.access_jwt,
        refreshJwt: res.rotated_credentials.refresh_jwt,
        did: res.rotated_credentials.did,
        handle: 'handle' in input.credentials ? input.credentials.handle : '',
      });
    }
    if (!res.cursor) break;
    cursor = res.cursor;
  }
  fetchProgress.update((p) => ({ ...p, status: 'done' }));
  return { saves };
}

export const fetchHydrator = {
  async start(input: FetchHydratorInput, deps: FetchHydratorDeps = {}): Promise<unknown> {
    if (input.backend.kind === 'helper') {
      try {
        return await runHelperPath(input, deps);
      } catch (e) {
        fetchProgress.update((p) => ({ ...p, status: 'cancelled' }));
        throw e;
      }
    }
    throw new Error('Pyodide path not yet implemented');
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/fetch-hydrator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fetch-hydrator.ts app/src/lib/fetch-hydrator.test.ts
git commit -m "feat(fetch-hydrator): helper path with pagination and rotated_credentials"
```

---

### Task 13: `fetchHydrator` — Pyodide path

**Files:**
- Modify: `app/src/lib/fetch-hydrator.ts`
- Test: `app/src/lib/fetch-hydrator.test.ts`

- [ ] **Step 1: Write failing test**

Append to `app/src/lib/fetch-hydrator.test.ts`:

```ts
import type { PyodideWorkerDriver } from './pyodide-worker-driver';

describe('fetchHydrator (pyodide path)', () => {
  it('delegates to driver.runFetchOnly() and returns its inventory', async () => {
    const fakeDriver = {
      runFetchOnly: vi.fn().mockResolvedValue({ saves: [{ uri: 'at://x' }] }),
    } as unknown as PyodideWorkerDriver;

    const inv = await fetchHydrator.start({
      backend: { kind: 'pyodide' },
      origin: '',
      credentials: { handle: 'a', appPassword: 'b', pds: 'c' },
    }, { driver: fakeDriver });

    expect(fakeDriver.runFetchOnly).toHaveBeenCalledWith({ handle: 'a', appPassword: 'b', pds: 'c' });
    expect(inv).toEqual({ saves: [{ uri: 'at://x' }] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/fetch-hydrator.test.ts`
Expected: FAIL — `Pyodide path not yet implemented`.

- [ ] **Step 3: Implement Pyodide path**

Modify `fetch-hydrator.ts`:

```ts
import type { PyodideWorkerDriver } from './pyodide-worker-driver';

// ...

export interface FetchHydratorDeps {
  // ... existing
  readonly driver?: PyodideWorkerDriver;
}

async function runPyodidePath(
  input: FetchHydratorInput,
  deps: FetchHydratorDeps,
): Promise<unknown> {
  if (!deps.driver) throw new Error('PyodideWorkerDriver not provided');
  resetFetchProgress();
  fetchProgress.set({ status: 'running', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] });
  if (!('appPassword' in input.credentials)) {
    throw new Error('Pyodide path requires app-password credentials');
  }
  const inv = await deps.driver.runFetchOnly({
    handle: input.credentials.handle,
    appPassword: input.credentials.appPassword,
    pds: input.credentials.pds,
  });
  fetchProgress.update((p) => ({ ...p, status: 'done' }));
  return inv;
}

export const fetchHydrator = {
  async start(input: FetchHydratorInput, deps: FetchHydratorDeps = {}): Promise<unknown> {
    if (input.backend.kind === 'helper') {
      try { return await runHelperPath(input, deps); }
      catch (e) { fetchProgress.update((p) => ({ ...p, status: 'cancelled' })); throw e; }
    }
    try { return await runPyodidePath(input, deps); }
    catch (e) { fetchProgress.update((p) => ({ ...p, status: 'cancelled' })); throw e; }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/fetch-hydrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fetch-hydrator.ts app/src/lib/fetch-hydrator.test.ts
git commit -m "feat(fetch-hydrator): Pyodide path via PyodideWorkerDriver"
```

---

## Phase F — enrich and thread hydrators

### Task 14: `enrichHydrator`

**Files:**
- Create: `app/src/lib/enrich-hydrator.ts`
- Test: `app/src/lib/enrich-hydrator.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/enrich-hydrator.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { enrichHydrator } from './enrich-hydrator';
import { enrichProgress, resetEnrichProgress } from './hydration-state';

describe('enrichHydrator (helper path)', () => {
  beforeEach(() => resetEnrichProgress());

  it('calls enrichUris and merges post_created_at deltas keyed by uri', async () => {
    const inv = { saves: [{ uri: 'at://a' }, { uri: 'at://b' }] };
    const fakeEnrich = vi.fn().mockResolvedValue({
      enriched: [{ uri: 'at://a', post_created_at: '2026-01-01T00:00:00Z' }],
      errors: [{ uri: 'at://b', reason: 'invalid at-uri' }],
    });
    const out = await enrichHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      inventory: inv,
    }, { enrichUris: fakeEnrich });

    expect((out as { saves: { uri: string; post_created_at?: string }[] }).saves).toEqual([
      { uri: 'at://a', post_created_at: '2026-01-01T00:00:00Z' },
      { uri: 'at://b' },
    ]);
    expect(get(enrichProgress).status).toBe('done');
    expect(get(enrichProgress).failed).toBe(1);
  });
});

describe('enrichHydrator (pyodide path)', () => {
  beforeEach(() => resetEnrichProgress());

  it('delegates to driver.runEnrichOnly()', async () => {
    const fakeDriver = { runEnrichOnly: vi.fn().mockResolvedValue({ saves: [{ uri: 'at://a', post_created_at: 'X' }] }) };
    const out = await enrichHydrator.start({
      backend: { kind: 'pyodide' },
      origin: '',
      inventory: { saves: [{ uri: 'at://a' }] },
    }, { driver: fakeDriver as never });
    expect(fakeDriver.runEnrichOnly).toHaveBeenCalledWith({ inventory: { saves: [{ uri: 'at://a' }] } });
    expect(out).toEqual({ saves: [{ uri: 'at://a', post_created_at: 'X' }] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/enrich-hydrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/enrich-hydrator.ts
import { enrichProgress, resetEnrichProgress } from './hydration-state';
import { enrichUris as defaultEnrichUris, type EnrichResponse } from './helper-client';
import type { PyodideWorkerDriver } from './pyodide-worker-driver';

export type EnrichBackend = { kind: 'helper' } | { kind: 'pyodide' };

export interface EnrichHydratorInput {
  readonly backend: EnrichBackend;
  readonly origin: string;
  readonly inventory: { readonly saves: readonly { readonly uri: string }[] };
}

export interface EnrichHydratorDeps {
  readonly enrichUris?: (origin: string, req: { uris: readonly string[] }) => Promise<EnrichResponse>;
  readonly driver?: PyodideWorkerDriver;
}

export const enrichHydrator = {
  async start(input: EnrichHydratorInput, deps: EnrichHydratorDeps = {}): Promise<unknown> {
    resetEnrichProgress();
    enrichProgress.set({ status: 'running', total: input.inventory.saves.length, fetched: 0, skipped: 0, failed: 0, failures: [] });
    try {
      if (input.backend.kind === 'helper') {
        const enrich = deps.enrichUris ?? defaultEnrichUris;
        const uris = input.inventory.saves.map((s) => s.uri);
        const res = await enrich(input.origin, { uris });
        const byUri = new Map(res.enriched.map((e) => [e.uri, e.post_created_at]));
        const merged = input.inventory.saves.map((s) => {
          const t = byUri.get(s.uri);
          return t ? { ...s, post_created_at: t } : s;
        });
        enrichProgress.update((p) => ({ ...p, status: 'done', fetched: res.enriched.length, failed: res.errors.length, failures: res.errors.map((e) => ({ url: e.uri, reason: e.reason })) }));
        return { ...input.inventory, saves: merged };
      }
      if (!deps.driver) throw new Error('PyodideWorkerDriver not provided');
      const out = await deps.driver.runEnrichOnly({ inventory: input.inventory });
      enrichProgress.update((p) => ({ ...p, status: 'done' }));
      return out;
    } catch (e) {
      enrichProgress.update((p) => ({ ...p, status: 'cancelled' }));
      throw e;
    }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/enrich-hydrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/enrich-hydrator.ts app/src/lib/enrich-hydrator.test.ts
git commit -m "feat(enrich-hydrator): helper + Pyodide paths"
```

---

### Task 15: `threadHydrator`

**Files:**
- Create: `app/src/lib/thread-hydrator.ts`
- Test: `app/src/lib/thread-hydrator.test.ts`

Follow the same shape as `enrichHydrator`. Helper path calls `hydrateThreads()`, merging `thread_replies / thread_schema_version / thread_fetched_at` into each save by URI. Pyodide path calls `driver.runThreadsOnly()`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { threadHydrator } from './thread-hydrator';
import { threadProgress, resetThreadProgress } from './hydration-state';

describe('threadHydrator (helper path)', () => {
  beforeEach(() => resetThreadProgress());

  it('calls hydrateThreads and merges thread fields keyed by uri', async () => {
    const fakeHT = vi.fn().mockResolvedValue({
      threaded: [{ uri: 'at://a', thread_replies: [], thread_schema_version: 4, thread_fetched_at: '2026-05-07T00:00:00Z' }],
      errors: [],
    });
    const out = await threadHydrator.start({
      backend: { kind: 'helper' },
      origin: 'http://x',
      inventory: { saves: [{ uri: 'at://a' }, { uri: 'at://b' }] },
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
    }, { hydrateThreads: fakeHT });

    const saves = (out as { saves: { uri: string; thread_replies?: unknown }[] }).saves;
    expect(saves[0].thread_replies).toEqual([]);
    expect(saves[1].thread_replies).toBeUndefined();
    expect(get(threadProgress).status).toBe('done');
  });
});

describe('threadHydrator (pyodide path)', () => {
  beforeEach(() => resetThreadProgress());

  it('delegates to driver.runThreadsOnly()', async () => {
    const fakeDriver = { runThreadsOnly: vi.fn().mockResolvedValue({ saves: [] }) };
    await threadHydrator.start({
      backend: { kind: 'pyodide' },
      origin: '',
      inventory: { saves: [] },
      credentials: { handle: 'h', appPassword: 'p', pds: 'd' },
    }, { driver: fakeDriver as never });
    expect(fakeDriver.runThreadsOnly).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/thread-hydrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/thread-hydrator.ts
import { threadProgress, resetThreadProgress } from './hydration-state';
import { hydrateThreads as defaultHydrateThreads, type FetchSavesCredentials, type HydrateThreadsResponse } from './helper-client';
import type { PyodideWorkerDriver } from './pyodide-worker-driver';

export type ThreadBackend = { kind: 'helper' } | { kind: 'pyodide' };

export interface ThreadHydratorInput {
  readonly backend: ThreadBackend;
  readonly origin: string;
  readonly inventory: { readonly saves: readonly { readonly uri: string }[] };
  readonly credentials: FetchSavesCredentials;
}

export interface ThreadHydratorDeps {
  readonly hydrateThreads?: (origin: string, req: { uris: readonly string[]; credentials: FetchSavesCredentials }) => Promise<HydrateThreadsResponse>;
  readonly driver?: PyodideWorkerDriver;
}

export const threadHydrator = {
  async start(input: ThreadHydratorInput, deps: ThreadHydratorDeps = {}): Promise<unknown> {
    resetThreadProgress();
    threadProgress.set({ status: 'running', total: input.inventory.saves.length, fetched: 0, skipped: 0, failed: 0, failures: [] });
    try {
      if (input.backend.kind === 'helper') {
        const ht = deps.hydrateThreads ?? defaultHydrateThreads;
        const uris = input.inventory.saves.map((s) => s.uri);
        const res = await ht(input.origin, { uris, credentials: input.credentials });
        const byUri = new Map(res.threaded.map((e) => [e.uri, e]));
        const merged = input.inventory.saves.map((s) => {
          const t = byUri.get(s.uri);
          return t ? { ...s, thread_replies: t.thread_replies, thread_schema_version: t.thread_schema_version, thread_fetched_at: t.thread_fetched_at } : s;
        });
        threadProgress.update((p) => ({ ...p, status: 'done', fetched: res.threaded.length, failed: res.errors.length, failures: res.errors.map((e) => ({ url: e.uri, reason: e.reason })) }));
        return { ...input.inventory, saves: merged };
      }
      if (!deps.driver) throw new Error('PyodideWorkerDriver not provided');
      if (!('appPassword' in input.credentials)) throw new Error('Pyodide path requires app-password credentials');
      const out = await deps.driver.runThreadsOnly({
        inventory: input.inventory,
        handle: input.credentials.handle,
        appPassword: input.credentials.appPassword,
        pds: input.credentials.pds,
      });
      threadProgress.update((p) => ({ ...p, status: 'done' }));
      return out;
    } catch (e) {
      threadProgress.update((p) => ({ ...p, status: 'cancelled' }));
      throw e;
    }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/thread-hydrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/thread-hydrator.ts app/src/lib/thread-hydrator.test.ts
git commit -m "feat(thread-hydrator): helper + Pyodide paths"
```

---

## Phase G — orchestrator

### Task 16: `orchestrate-refresh.ts`

**Files:**
- Create: `app/src/lib/orchestrate-refresh.ts`
- Test: `app/src/lib/orchestrate-refresh.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/orchestrate-refresh.test.ts
import { describe, expect, it, vi } from 'vitest';
import { orchestrateRefresh } from './orchestrate-refresh';

describe('orchestrateRefresh', () => {
  it('calls fetch → enrich → threads in order when threads is true', async () => {
    const order: string[] = [];
    const fetchH = vi.fn().mockImplementation(async () => { order.push('fetch'); return { saves: [{ uri: 'at://a' }] }; });
    const enrichH = vi.fn().mockImplementation(async () => { order.push('enrich'); return { saves: [{ uri: 'at://a', post_created_at: 'X' }] }; });
    const threadH = vi.fn().mockImplementation(async () => { order.push('threads'); return { saves: [{ uri: 'at://a', post_created_at: 'X', thread_replies: [] }] }; });

    await orchestrateRefresh({
      credentials: { handle: 'a', appPassword: 'b', pds: 'c' },
      includeThreads: true,
      snapshot: {
        helper: { detected: true, version: '0.4.1', features: ['fetch', 'enrich', 'hydrate-threads', 'jwt-credentials'] },
        fetch: { kind: 'helper' }, enrich: { kind: 'helper' }, threads: { kind: 'helper' },
        images: { kind: 'helper' }, articles: { kind: 'helper' },
      },
      origin: 'http://x',
    }, { fetchHydrator: { start: fetchH }, enrichHydrator: { start: enrichH }, threadHydrator: { start: threadH } });

    expect(order).toEqual(['fetch', 'enrich', 'threads']);
  });

  it('skips threads when includeThreads is false', async () => {
    const fetchH = vi.fn().mockResolvedValue({ saves: [] });
    const enrichH = vi.fn().mockResolvedValue({ saves: [] });
    const threadH = vi.fn();
    await orchestrateRefresh({
      credentials: { handle: 'a', appPassword: 'b', pds: 'c' },
      includeThreads: false,
      snapshot: { /* same as above */ } as never,
      origin: 'http://x',
    }, { fetchHydrator: { start: fetchH }, enrichHydrator: { start: enrichH }, threadHydrator: { start: threadH } });
    expect(threadH).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/orchestrate-refresh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/orchestrate-refresh.ts
import type { CapabilitySnapshot } from './capability-snapshot';
import type { FetchSavesCredentials } from './helper-client';
import { fetchHydrator as defaultFetchHydrator } from './fetch-hydrator';
import { enrichHydrator as defaultEnrichHydrator } from './enrich-hydrator';
import { threadHydrator as defaultThreadHydrator } from './thread-hydrator';

export interface OrchestrateRefreshInput {
  readonly credentials: FetchSavesCredentials;
  readonly includeThreads: boolean;
  readonly snapshot: CapabilitySnapshot;
  readonly origin: string;
}

export interface OrchestrateRefreshDeps {
  readonly fetchHydrator?:  { start: typeof defaultFetchHydrator.start };
  readonly enrichHydrator?: { start: typeof defaultEnrichHydrator.start };
  readonly threadHydrator?: { start: typeof defaultThreadHydrator.start };
}

export async function orchestrateRefresh(
  input: OrchestrateRefreshInput,
  deps: OrchestrateRefreshDeps = {},
): Promise<unknown> {
  const fetchH  = deps.fetchHydrator  ?? defaultFetchHydrator;
  const enrichH = deps.enrichHydrator ?? defaultEnrichHydrator;
  const threadH = deps.threadHydrator ?? defaultThreadHydrator;

  let inv = await fetchH.start({
    backend: input.snapshot.fetch,
    origin: input.origin,
    credentials: input.credentials,
  }) as { saves: readonly { uri: string }[] };

  inv = await enrichH.start({
    backend: input.snapshot.enrich,
    origin: input.origin,
    inventory: inv,
  }) as typeof inv;

  if (input.includeThreads) {
    inv = await threadH.start({
      backend: input.snapshot.threads,
      origin: input.origin,
      inventory: inv,
      credentials: input.credentials,
    }) as typeof inv;
  }

  return inv;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/orchestrate-refresh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/orchestrate-refresh.ts app/src/lib/orchestrate-refresh.test.ts
git commit -m "feat(orchestrate-refresh): sequence fetch -> enrich -> (threads)"
```

---

## Phase H — engine.ts shim + integration

### Task 17: Replace `engine.ts` internals with the orchestrator

**Files:**
- Modify: `app/src/lib/engine.ts`
- Modify: `app/src/lib/engine.test.ts` (existing tests need updating)

- [ ] **Step 1: Write failing test**

Update `app/src/lib/engine.test.ts` to verify the new internals. Replace the existing runner-based test with one that asserts `engine.runJob` calls the orchestrator and returns `{session, inventory}`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runJob } from './engine';

describe('runJob (orchestrator-shim)', () => {
  it('delegates to orchestrateRefresh and returns session+inventory', async () => {
    const orchestrate = vi.fn().mockResolvedValue({ saves: [{ uri: 'at://x' }] });
    const createSession = vi.fn().mockResolvedValue({ accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1', handle: 'a.bsky.social' });

    const out = await runJob({
      mode: 'password',
      pds: 'https://bsky.social',
      handle: 'a.bsky.social',
      appPassword: 'pw',
      fetch: true,
      threads: true,
    }, { createSession, orchestrate });

    expect(orchestrate).toHaveBeenCalled();
    expect(out.inventory).toEqual({ saves: [{ uri: 'at://x' }] });
    expect(out.session.handle).toBe('a.bsky.social');
  });
});
```

(Note: this changes the public test surface for `runJob` deps. Earlier tests that injected a `runner` will need their assertions updated.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/engine.test.ts`
Expected: FAIL — `orchestrate` is not an accepted dep, or behavior doesn't match.

- [ ] **Step 3: Implement engine.ts shim**

Replace `app/src/lib/engine.ts` body:

```ts
import { get } from 'svelte/store';
import { createSession as defaultCreateSession, type AtSession } from './atproto';
import { saveInventory } from './inventory-store';
import { saveAccount } from './account-store';
import { setLastSession } from './last-session';
import { orchestrateRefresh } from './orchestrate-refresh';
import { capabilitySnapshot } from './capability-snapshot';
import { config } from './config';

export interface RunJobOptionsCommon {
  readonly pds: string;
  readonly fetch: boolean;
  readonly threads: boolean;
}

export type RunJobInput =
  | (RunJobOptionsCommon & { readonly mode: 'password'; readonly handle: string; readonly appPassword: string; })
  | (RunJobOptionsCommon & { readonly mode: 'session'; readonly session: AtSession; });

export interface RunJobDeps {
  readonly createSession?: typeof defaultCreateSession;
  readonly orchestrate?: typeof orchestrateRefresh;
  readonly onLog?: (msg: string) => void;
}

export interface RunJobResult {
  readonly session: AtSession;
  readonly inventory: unknown;
}

export async function runJob(input: RunJobInput, deps: RunJobDeps = {}): Promise<RunJobResult> {
  const createSession = deps.createSession ?? defaultCreateSession;
  const orchestrate = deps.orchestrate ?? orchestrateRefresh;
  const log = deps.onLog ?? (() => {});

  if (!input.fetch && !input.threads) {
    throw new Error('Pick at least one step to run.');
  }

  let session: AtSession;
  if (input.mode === 'password') {
    log('Signing in…');
    session = await createSession({ pds: input.pds, identifier: input.handle, password: input.appPassword });
    log(`Signed in as @${session.handle}.`);
  } else {
    session = input.session;
    log(`Reusing session for @${session.handle}.`);
  }

  setLastSession({
    pds: input.pds,
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
    did: session.did,
    handle: session.handle,
  });

  const credentials =
    input.mode === 'password'
      ? { handle: input.handle, appPassword: input.appPassword, pds: input.pds }
      : { accessJwt: session.accessJwt, refreshJwt: session.refreshJwt, did: session.did, pds: input.pds };

  log('Fetching saves…');
  const inventory = await orchestrate({
    credentials,
    includeThreads: input.threads,
    snapshot: get(capabilitySnapshot),
    origin: config.helperOrigin,
  });

  await saveInventory(inventory);
  await saveAccount(session.handle);
  log('Inventory saved.');
  return { session, inventory };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite to verify Run.svelte still works (compile check)**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/engine.ts app/src/lib/engine.test.ts
git commit -m "refactor(engine): shim around orchestrateRefresh"
```

---

### Task 18: Delete `pyodide-runner.ts` and its test

**Files:**
- Delete: `app/src/lib/pyodide-runner.ts`
- Delete: `app/src/lib/pyodide-runner.test.ts`

- [ ] **Step 1: Verify nothing imports it**

Run: `grep -rn "pyodide-runner\|PyodideRunner" app/src --include="*.ts" --include="*.svelte" | grep -v ".test." | grep -v "pyodide-runner.ts"`
Expected: no matches (the engine.ts shim no longer needs it).

If matches appear, update the offending file to use `PyodideWorkerDriver` instead.

- [ ] **Step 2: Delete the files**

```bash
rm app/src/lib/pyodide-runner.ts app/src/lib/pyodide-runner.test.ts
```

- [ ] **Step 3: Run full test suite**

Run: `cd app && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A app/src/lib/pyodide-runner.ts app/src/lib/pyodide-runner.test.ts
git commit -m "chore: delete pyodide-runner.ts (replaced by pyodide-worker-driver)"
```

---

## Phase I — migrate existing hydrators

### Task 19: `image-hydrator` reads `CapabilitySnapshot.images`

**Files:**
- Modify: `app/src/lib/image-hydrator.ts`
- Modify: `app/src/lib/image-hydrator.test.ts`

- [ ] **Step 1: Inspect current image-hydrator**

Run: `grep -n "describeAvailableImageBackend\|chooseImageBackend\|fetchImageViaHelper\|describe-backend" app/src/lib/image-hydrator.ts`

Identify where the routing decision is made today.

- [ ] **Step 2: Update routing to read snapshot**

Add an injectable `getSnapshot` dep to image-hydrator (defaulting to `() => get(capabilitySnapshot)`). Replace the per-call `describeAvailableImageBackend()` call with a `switch (snapshot.images.kind)` against the snapshot. Behavior unchanged — same backend ends up chosen, but read from one source.

- [ ] **Step 3: Update tests**

Tests that previously injected mocks for backend description should now inject a `CapabilitySnapshot`. Each existing test stays the same in spirit; only the dep injection shape changes.

- [ ] **Step 4: Run tests**

Run: `cd app && npx vitest run src/lib/image-hydrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/image-hydrator.ts app/src/lib/image-hydrator.test.ts
git commit -m "refactor(image-hydrator): route via CapabilitySnapshot"
```

---

### Task 20: `article-hydrator` reads `CapabilitySnapshot.articles`

**Files:**
- Modify: `app/src/lib/article-hydrator.ts`
- Modify: `app/src/lib/article-hydrator.test.ts`

Same pattern as Task 19, applied to article-hydrator.

- [ ] **Step 1: Inspect**

Run: `grep -n "describeArticleBackend\|extractArticleViaHelper\|describe-backend" app/src/lib/article-hydrator.ts`

- [ ] **Step 2: Update routing to read snapshot**

Replace per-call backend description with snapshot-driven dispatch.

- [ ] **Step 3: Update tests**

- [ ] **Step 4: Run tests**

Run: `cd app && npx vitest run src/lib/article-hydrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/article-hydrator.ts app/src/lib/article-hydrator.test.ts
git commit -m "refactor(article-hydrator): route via CapabilitySnapshot"
```

---

## Phase J — version bump and final verification

### Task 21: Bump `MIN_HELPER_VERSION` to `0.4.1`

**Files:**
- Modify: `app/src/lib/min-helper-version.ts`
- Modify: `app/src/lib/min-helper-version.test.ts`

- [ ] **Step 1: Update version constant**

```ts
export const MIN_HELPER_VERSION = '0.4.1';
```

Update the leading comment to mention the JWT-pair credentials path.

- [ ] **Step 2: Update tests**

Adjust the version threshold tests:

```ts
it('treats versions older than the minimum as outdated', () => {
  expect(isHelperOutdated('0.4.0')).toBe(true);
  expect(isHelperOutdated('0.3.1')).toBe(true);
  expect(isHelperOutdated('0.0.1')).toBe(true);
});

it('treats newer versions as not outdated', () => {
  expect(isHelperOutdated('0.4.2')).toBe(false);
  expect(isHelperOutdated('0.5.0')).toBe(false);
  expect(isHelperOutdated('1.0.0')).toBe(false);
});
```

- [ ] **Step 3: Run tests**

Run: `cd app && npx vitest run src/lib/min-helper-version.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/min-helper-version.ts app/src/lib/min-helper-version.test.ts
git commit -m "chore(min-helper-version): bump floor to 0.4.1"
```

---

### Task 22: Full test pass + manual smoke

**Files:** none.

- [ ] **Step 1: Run the entire suite**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: all tests pass; type-check clean.

- [ ] **Step 2: Manual smoke (helper present)**

If a `bsky-saves` v0.4.1 helper is running locally:
1. `cd app && npm run dev`
2. Sign in with valid credentials.
3. Click "Run" on the Run page (existing UX; nothing changed).
4. Confirm the inventory loads and Library renders.
5. Open devtools → Network: confirm requests to `127.0.0.1:47826/fetch`, `/enrich`, `/hydrate-threads` (not Pyodide).

- [ ] **Step 3: Manual smoke (helper absent)**

Stop the helper. Reload the app. Repeat the run. Confirm Pyodide path runs (no requests to 127.0.0.1:47826/fetch; existing pyodide WASM cold-start visible).

- [ ] **Step 4: Final commit (if anything changed)**

```bash
git status
# If anything is uncommitted, commit appropriately.
```

If everything passes cleanly, this plan is complete.

---

## Spec coverage check

| Spec section | Covered by |
|---|---|
| §4 Architecture overview | All tasks (collectively). |
| §5 CapabilitySnapshot | Tasks 1–4. |
| §6 Hydrators | Tasks 12–15, 19, 20. |
| §7 Orchestration | Tasks 16–17. |
| §8 Inventory shape (`parseInventory`) | No work needed — `parseInventory` already accepts the snake_case shape. |
| §9 Auth (rotated_credentials) | Tasks 6, 12. |
| §10 Error handling | Tasks 5, 6, 12 (per-hydrator error → `progress.failures[]`). |
| §11 Library status panel visual contract | DEFERRED to Plan 2. |
| §12 Migration / deletions (engine.ts shim, pyodide-runner.ts gone) | Tasks 17, 18. |
| §13 Testing | Each task has TDD tests. |
| §14 Dependencies | Tasks 21 (version bump). Helper v0.4.1 must be available; routing falls back gracefully if not. |
| §17 Acceptance criteria | Tasks 22 (manual smoke). |

Acceptance items deferred to Plan 2: Library hub UX, route deletion, SignIn flow change, Settings toggles, install-helper hint, banners.
