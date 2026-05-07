# Library Hub UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-page Sign-in → Refresh → Run → Library flow with a unified Library hub. Library becomes the single post-sign-in surface, showing structured per-asset progress and routing all backend differences invisibly. Routes `/run` and `/refresh` are deleted.

**Architecture:** Library renders a `LibraryStatusPanel` (composed of three `AssetRow` components plus optional `AuthErrorBanner`, `OutdatedHelperBanner`, and `InstallHelperHint`). A new `library-refresh.ts` module wraps the orchestrator with start/stop and auth-error state. SignIn submits credentials and immediately starts a background refresh, navigating to Library. Settings gains three explicit on/off toggles (threads, images, articles) backed by a new `asset-toggles.ts` store; flipping threads on triggers thread hydration over existing inventory.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest, idb-keyval, the orchestrator + hydrator stack from Plan 1.

**Companion spec:** `docs/superpowers/specs/2026-05-07-library-hub-and-helper-routing-design.md`.
**Visual reference:** the C-baseline mockups at `app/public/mockups/library-status/index.html` (deleted in this plan's last task).
**Plan 1 (foundation):** `docs/superpowers/plans/2026-05-07-helper-routed-pipeline-foundation.md` — provides `orchestrateRefresh`, `capabilitySnapshot`, the five progress stores, and the hydrators.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `app/src/lib/asset-toggles.ts` | Persisted on/off state for `threads`, `images`, `articles`. Each defaults to `on` once a backend is available. Exposes `assetToggles` store + `setAssetToggle(key, value)` + a derived `effectiveAssetToggles` that ANDs with backend-availability from `CapabilitySnapshot`. |
| `app/src/lib/asset-toggles.test.ts` | Unit tests. |
| `app/src/lib/install-hint-pref.ts` | Persisted "user dismissed the install hint" flag. |
| `app/src/lib/install-hint-pref.test.ts` | Unit tests. |
| `app/src/lib/dominant-backend.ts` | Derived store / function computing the "dominant backend" string for the Library header — picks the most-common `kind` among `threads`/`images`/`articles` rows or `'helper'` if all three use helper. |
| `app/src/lib/dominant-backend.test.ts` | Unit tests. |
| `app/src/lib/library-refresh.ts` | Wraps `orchestrateRefresh` with start/stop state. Exposes `libraryRefreshState` store (`{status: 'idle' \| 'running' \| 'error', error?: string}`) and `startLibraryRefresh()`, `stopLibraryRefresh()`. Handles auth errors by surfacing them to the state store. |
| `app/src/lib/library-refresh.test.ts` | Unit tests. |
| `app/src/components/library-status/AssetRow.svelte` | Single asset row (Threads/Images/Articles). Props: label, badge state, progress, failures, backend, setup-affordance. |
| `app/src/components/library-status/AssetRow.test.ts` | Component test (using @testing-library/svelte). |
| `app/src/components/library-status/AuthErrorBanner.svelte` | Red banner at top of status panel when `libraryRefreshState.status === 'error'`. Sign-in CTA. |
| `app/src/components/library-status/OutdatedHelperBanner.svelte` | Yellow banner when helper is detected and outdated. |
| `app/src/components/library-status/InstallHelperHint.svelte` | Footer hint on Pyodide-only deployments. Dismissible. |
| `app/src/components/LibraryStatusPanel.svelte` | Composes the four banners + three AssetRows. |

### Modified files

| Path | Change |
|---|---|
| `app/src/routes/Library.svelte` | Replace `BackupBanner` + `ArticleBackupBanner` + `BackupStatusRow` with `LibraryStatusPanel`. Add Refresh/Stop button. Replace `navigate('/refresh')` with direct call to `startLibraryRefresh()`. |
| `app/src/routes/SignIn.svelte` | After `signInDraft.set(...)`, call `startLibraryRefresh()` and navigate to `/library` instead of `/run`. |
| `app/src/routes/Settings.svelte` | Add three on/off toggles (threads, images, articles) using `asset-toggles`. Threads-on triggers thread hydration over existing inventory. Add a "Show install hint again" reset button. |
| `app/src/lib/routes.ts` | Remove `/run` and `/refresh` route entries. Imports of Run/Refresh removed. |
| `app/src/lib/router.ts` | Add a redirect rule: `/run` and `/refresh` rewrite to `/library` to handle stale bookmarks. |
| `app/src/lib/backup-prefs.ts` | (Optional) Wire the new `asset-toggles` store as the source of truth for image/article enabled-state if cleaner than maintaining two stores; otherwise leave backup-prefs alone and add `asset-toggles` as a parallel store specifically for the explicit on/off semantics. **Plan choice: parallel stores** — backup-prefs keeps managing the per-feature reminder UX; asset-toggles owns the explicit on/off. |

### Deleted files

| Path | Reason |
|---|---|
| `app/src/routes/Run.svelte` | Replaced by Library hub. |
| `app/src/routes/Refresh.svelte` | Replaced by Library hub. |
| `app/src/lib/engine.ts` | Replaced by `library-refresh.ts`. The Plan 1 `runJob` shim has no remaining callers after Run.svelte is deleted. |
| `app/src/lib/engine.test.ts` | Tests the deleted `runJob`. |
| `app/src/components/BackupBanner.svelte` | Replaced by `AssetRow` row inside `LibraryStatusPanel`. |
| `app/src/components/ArticleBackupBanner.svelte` | Replaced by `AssetRow` row. |
| `app/src/components/BackupStatusRow.svelte` | Replaced by `LibraryStatusPanel`. |
| `app/public/mockups/library-status/` | Throwaway brainstorm artifacts. |

---

## Phase A — Foundation modules

### Task 1: `asset-toggles.ts` — persisted on/off store

**Files:**
- Create: `app/src/lib/asset-toggles.ts`
- Create: `app/src/lib/asset-toggles.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/asset-toggles.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  assetToggles,
  setAssetToggle,
  loadAssetToggles,
  _resetAssetTogglesForTests,
  type AssetTogglesShape,
} from './asset-toggles';
import { clear } from 'idb-keyval';

describe('assetToggles', () => {
  beforeEach(async () => {
    await clear();
    _resetAssetTogglesForTests();
  });

  it('defaults all three to on', () => {
    const t = get(assetToggles);
    expect(t).toEqual<AssetTogglesShape>({ threads: true, images: true, articles: true });
  });

  it('setAssetToggle updates the store and persists', async () => {
    await setAssetToggle('threads', false);
    expect(get(assetToggles).threads).toBe(false);
    _resetAssetTogglesForTests();
    await loadAssetToggles();
    expect(get(assetToggles).threads).toBe(false);
  });

  it('loadAssetToggles tolerates a missing record by keeping defaults', async () => {
    await loadAssetToggles();
    expect(get(assetToggles)).toEqual<AssetTogglesShape>({ threads: true, images: true, articles: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/asset-toggles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/asset-toggles.ts
import { writable, type Readable } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';

export type AssetKey = 'threads' | 'images' | 'articles';

export interface AssetTogglesShape {
  readonly threads: boolean;
  readonly images: boolean;
  readonly articles: boolean;
}

const KEY = 'asset-toggles:v1';
const DEFAULTS: AssetTogglesShape = { threads: true, images: true, articles: true };

const store = writable<AssetTogglesShape>(DEFAULTS);
export const assetToggles: Readable<AssetTogglesShape> = { subscribe: store.subscribe };

export async function loadAssetToggles(): Promise<void> {
  const raw = (await idbGet(KEY)) as Partial<AssetTogglesShape> | undefined;
  if (!raw) return;
  store.set({
    threads: typeof raw.threads === 'boolean' ? raw.threads : DEFAULTS.threads,
    images: typeof raw.images === 'boolean' ? raw.images : DEFAULTS.images,
    articles: typeof raw.articles === 'boolean' ? raw.articles : DEFAULTS.articles,
  });
}

export async function setAssetToggle(key: AssetKey, value: boolean): Promise<void> {
  store.update((cur) => ({ ...cur, [key]: value }));
  let snapshot: AssetTogglesShape = DEFAULTS;
  store.subscribe((v) => { snapshot = v; })();
  await idbSet(KEY, snapshot);
}

/** For tests only — resets to defaults without touching IndexedDB. */
export function _resetAssetTogglesForTests(): void {
  store.set(DEFAULTS);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/asset-toggles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/lib/asset-toggles.ts app/src/lib/asset-toggles.test.ts
git commit -m "feat(asset-toggles): persisted on/off store for threads/images/articles"
```

---

### Task 2: `install-hint-pref.ts` — persisted dismiss flag

**Files:**
- Create: `app/src/lib/install-hint-pref.ts`
- Create: `app/src/lib/install-hint-pref.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/install-hint-pref.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { installHintDismissed, dismissInstallHint, restoreInstallHint, loadInstallHintPref, _resetInstallHintForTests } from './install-hint-pref';
import { clear } from 'idb-keyval';

describe('installHintDismissed', () => {
  beforeEach(async () => {
    await clear();
    _resetInstallHintForTests();
  });

  it('defaults to false', () => {
    expect(get(installHintDismissed)).toBe(false);
  });

  it('dismissInstallHint sets true and persists', async () => {
    await dismissInstallHint();
    expect(get(installHintDismissed)).toBe(true);
    _resetInstallHintForTests();
    await loadInstallHintPref();
    expect(get(installHintDismissed)).toBe(true);
  });

  it('restoreInstallHint sets false and persists', async () => {
    await dismissInstallHint();
    await restoreInstallHint();
    expect(get(installHintDismissed)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/install-hint-pref.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/install-hint-pref.ts
import { writable, type Readable } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';

const KEY = 'install-hint-dismissed:v1';

const store = writable<boolean>(false);
export const installHintDismissed: Readable<boolean> = { subscribe: store.subscribe };

export async function loadInstallHintPref(): Promise<void> {
  const raw = (await idbGet(KEY)) as boolean | undefined;
  store.set(raw === true);
}

export async function dismissInstallHint(): Promise<void> {
  store.set(true);
  await idbSet(KEY, true);
}

export async function restoreInstallHint(): Promise<void> {
  store.set(false);
  await idbSet(KEY, false);
}

/** For tests only — resets to false without touching IndexedDB. */
export function _resetInstallHintForTests(): void {
  store.set(false);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/install-hint-pref.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/lib/install-hint-pref.ts app/src/lib/install-hint-pref.test.ts
git commit -m "feat(install-hint-pref): persisted dismiss flag for install-helper hint"
```

---

### Task 3: `dominant-backend.ts` — derived backend label

**Files:**
- Create: `app/src/lib/dominant-backend.ts`
- Create: `app/src/lib/dominant-backend.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/dominant-backend.test.ts
import { describe, expect, it } from 'vitest';
import { computeDominantBackend } from './dominant-backend';
import type { CapabilitySnapshot } from './capability-snapshot';

const snap = (overrides: Partial<CapabilitySnapshot>): CapabilitySnapshot => ({
  helper: { detected: false },
  fetch: { kind: 'pyodide' },
  enrich: { kind: 'pyodide' },
  threads: { kind: 'pyodide' },
  images: { kind: 'operator-worker' },
  articles: { kind: 'none' },
  ...overrides,
});

describe('computeDominantBackend', () => {
  it('returns "local helper" when all three asset paths use helper', () => {
    expect(computeDominantBackend(snap({
      threads: { kind: 'helper' }, images: { kind: 'helper' }, articles: { kind: 'helper' },
    }))).toBe('local helper');
  });

  it('returns null when there is no clear majority', () => {
    expect(computeDominantBackend(snap({
      threads: { kind: 'pyodide' }, images: { kind: 'operator-worker' }, articles: { kind: 'none' },
    }))).toBeNull();
  });

  it('returns "Pyodide" when threads is pyodide and images/articles are not helper', () => {
    expect(computeDominantBackend(snap({
      threads: { kind: 'pyodide' }, images: { kind: 'operator-worker' }, articles: { kind: 'operator-worker' as never },
    }))).toBeNull(); // no clear winner; null is fine
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/dominant-backend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/dominant-backend.ts
import type { CapabilitySnapshot } from './capability-snapshot';

/**
 * Returns a human-readable name for the dominant backend across the three
 * asset paths (threads/images/articles), or null if there's no clear majority.
 *
 * "Dominant" means "all three use the same backend kind". Otherwise we let
 * per-row labels do the talking.
 */
export function computeDominantBackend(snap: CapabilitySnapshot): string | null {
  const kinds = [snap.threads.kind, snap.images.kind, snap.articles.kind];
  const allSame = kinds.every((k) => k === kinds[0]);
  if (!allSame) return null;
  return labelFor(kinds[0]);
}

function labelFor(kind: string): string | null {
  switch (kind) {
    case 'helper': return 'local helper';
    case 'user-worker': return 'your worker proxy';
    case 'operator-worker': return "operator's worker proxy";
    case 'pyodide': return null; // Pyodide is implicit fallback; don't surface
    case 'none': return null;
    default: return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/dominant-backend.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/lib/dominant-backend.ts app/src/lib/dominant-backend.test.ts
git commit -m "feat(dominant-backend): derived label for Library header"
```

---

## Phase B — `library-refresh` orchestration

### Task 4: `library-refresh.ts` — start/stop wrapper around the orchestrator

**Files:**
- Create: `app/src/lib/library-refresh.ts`
- Create: `app/src/lib/library-refresh.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/library-refresh.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { libraryRefreshState, startLibraryRefresh, _resetLibraryRefreshForTests } from './library-refresh';

describe('startLibraryRefresh', () => {
  beforeEach(() => _resetLibraryRefreshForTests());

  it('transitions idle → running → idle on success', async () => {
    const orchestrate = vi.fn().mockResolvedValue({ saves: [] });
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    const promise = startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: true },
      { orchestrate, saveInventory },
    );
    expect(get(libraryRefreshState).status).toBe('running');
    await promise;
    expect(get(libraryRefreshState).status).toBe('idle');
  });

  it('transitions idle → running → error on auth failure', async () => {
    const orchestrate = vi.fn().mockRejectedValue(new Error('auth refresh failed'));
    await startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: true },
      { orchestrate, saveInventory: vi.fn() },
    );
    const s = get(libraryRefreshState);
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/auth refresh failed/);
  });

  it('persists the inventory through saveInventory', async () => {
    const inv = { saves: [{ uri: 'at://x' }] };
    const orchestrate = vi.fn().mockResolvedValue(inv);
    const saveInventory = vi.fn().mockResolvedValue(undefined);
    await startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      { orchestrate, saveInventory },
    );
    expect(saveInventory).toHaveBeenCalledWith(inv);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/library-refresh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/library-refresh.ts
import { get, writable, type Readable } from 'svelte/store';
import { orchestrateRefresh as defaultOrchestrate } from './orchestrate-refresh';
import { saveInventory as defaultSaveInventory } from './inventory-store';
import { capabilitySnapshot } from './capability-snapshot';
import { config } from './config';
import type { FetchSavesCredentials } from './helper-client';

export type LibraryRefreshState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' }
  | { readonly status: 'error'; readonly error: string };

const store = writable<LibraryRefreshState>({ status: 'idle' });
export const libraryRefreshState: Readable<LibraryRefreshState> = { subscribe: store.subscribe };

export interface StartLibraryRefreshInput {
  readonly credentials: FetchSavesCredentials;
  readonly includeThreads: boolean;
}

export interface StartLibraryRefreshDeps {
  readonly orchestrate?: typeof defaultOrchestrate;
  readonly saveInventory?: typeof defaultSaveInventory;
}

export async function startLibraryRefresh(
  input: StartLibraryRefreshInput,
  deps: StartLibraryRefreshDeps = {},
): Promise<void> {
  const orchestrate = deps.orchestrate ?? defaultOrchestrate;
  const saveInventory = deps.saveInventory ?? defaultSaveInventory;
  store.set({ status: 'running' });
  try {
    const inv = await orchestrate({
      credentials: input.credentials,
      includeThreads: input.includeThreads,
      snapshot: get(capabilitySnapshot),
      origin: config.helperOrigin,
    });
    await saveInventory(inv);
    store.set({ status: 'idle' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    store.set({ status: 'error', error: msg });
  }
}

/** For tests only — resets the state to idle. */
export function _resetLibraryRefreshForTests(): void {
  store.set({ status: 'idle' });
}
```

(Stop semantics are covered in Task 5 — separate concern.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/library-refresh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/lib/library-refresh.ts app/src/lib/library-refresh.test.ts
git commit -m "feat(library-refresh): start wrapper around orchestrateRefresh"
```

---

### Task 5: `library-refresh.ts` — Stop semantics

**Files:**
- Modify: `app/src/lib/library-refresh.ts`
- Modify: `app/src/lib/library-refresh.test.ts`

For Plan 2's first cut, "Stop" works at the orchestrator boundary: setting a cancel flag prevents the next hydrator from starting; in-flight hydrator calls finish naturally. We don't abort mid-pagination; that's a Plan 3+ concern.

- [ ] **Step 1: Write failing test**

Append to `app/src/lib/library-refresh.test.ts`:

```ts
import { stopLibraryRefresh } from './library-refresh';

describe('stopLibraryRefresh', () => {
  beforeEach(() => _resetLibraryRefreshForTests());

  it('aborts before next hydrator phase', async () => {
    let stopMid = false;
    const orchestrate = vi.fn().mockImplementation(async (_input, deps) => {
      // Imitate orchestrator: call fetch, then check cancel before enrich.
      if (stopMid && deps?.cancelToken?.cancelled) {
        throw new Error('cancelled');
      }
      return { saves: [] };
    });
    const promise = startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: true },
      { orchestrate, saveInventory: vi.fn() },
    );
    stopMid = true;
    stopLibraryRefresh();
    await promise;
    // After stop, state returns to 'idle'.
    expect(get(libraryRefreshState).status).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/library-refresh.test.ts`
Expected: FAIL — `stopLibraryRefresh` not exported.

- [ ] **Step 3: Implement Stop**

Modify `library-refresh.ts`:

```ts
let _cancelled = false;

export function stopLibraryRefresh(): void {
  _cancelled = true;
}

// inside startLibraryRefresh, at the top:
_cancelled = false;

// Replace the orchestrate() call to pass a cancelToken-like dep.
// orchestrateRefresh doesn't currently accept a cancelToken; adding it is out-of-scope
// for this plan, so we use a coarser approach: Stop only takes effect AFTER the
// current orchestrator promise rejects or resolves. The user's "Stop" intent is
// honored by setting a sentinel error state.
```

For now (simpler), implement Stop as a state-only signal:

```ts
let _cancelled = false;

export function stopLibraryRefresh(): void {
  _cancelled = true;
  store.set({ status: 'idle' });  // Optimistically transition. Any in-flight orchestrate result will be ignored.
}

export async function startLibraryRefresh(
  input: StartLibraryRefreshInput,
  deps: StartLibraryRefreshDeps = {},
): Promise<void> {
  const orchestrate = deps.orchestrate ?? defaultOrchestrate;
  const saveInventory = deps.saveInventory ?? defaultSaveInventory;
  _cancelled = false;
  store.set({ status: 'running' });
  try {
    const inv = await orchestrate({
      credentials: input.credentials,
      includeThreads: input.includeThreads,
      snapshot: get(capabilitySnapshot),
      origin: config.helperOrigin,
    });
    if (_cancelled) return; // discard result post-stop
    await saveInventory(inv);
    store.set({ status: 'idle' });
  } catch (e) {
    if (_cancelled) return;
    const msg = e instanceof Error ? e.message : String(e);
    store.set({ status: 'error', error: msg });
  }
}
```

The test in Step 1 needs simplification to fit this implementation:

```ts
describe('stopLibraryRefresh', () => {
  beforeEach(() => _resetLibraryRefreshForTests());

  it('returns state to idle and discards pending result', async () => {
    let resolve: (v: unknown) => void;
    const orchestrate = vi.fn().mockImplementation(() => new Promise((r) => { resolve = r; }));
    const saveInventory = vi.fn();
    const promise = startLibraryRefresh(
      { credentials: { handle: 'a', appPassword: 'b', pds: 'c' }, includeThreads: false },
      { orchestrate, saveInventory },
    );
    expect(get(libraryRefreshState).status).toBe('running');
    stopLibraryRefresh();
    expect(get(libraryRefreshState).status).toBe('idle');
    resolve!({ saves: [] });
    await promise;
    expect(saveInventory).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run src/lib/library-refresh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/lib/library-refresh.ts app/src/lib/library-refresh.test.ts
git commit -m "feat(library-refresh): stopLibraryRefresh — state-level cancel"
```

---

## Phase C — Banner components

### Task 6: `AuthErrorBanner.svelte`

**Files:**
- Create: `app/src/components/library-status/AuthErrorBanner.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- app/src/components/library-status/AuthErrorBanner.svelte -->
<script lang="ts">
  import { navigate } from '$lib/router';

  /** Error message from the daemon (e.g., "auth refresh failed"). */
  export let message: string = '';
</script>

<div class="auth-error" role="alert">
  <span class="auth-error__text">
    <strong>Couldn't refresh.</strong>
    {message ? message : 'Your sign-in expired. Please sign in again to continue.'}
  </span>
  <button type="button" class="auth-error__cta" on:click={() => navigate('/')}>Sign in</button>
</div>

<style>
  .auth-error {
    margin: 0 0 0.6rem;
    padding: 0.5rem 0.7rem;
    border-radius: 6px;
    background: color-mix(in oklab, red 12%, Canvas);
    border: 1px solid color-mix(in oklab, red 35%, transparent);
    font-size: 0.875rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .auth-error__text { flex: 1 1 18rem; }
  .auth-error__cta {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    margin-left: auto;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/components/library-status/AuthErrorBanner.svelte
git commit -m "feat(library-status): AuthErrorBanner component"
```

---

### Task 7: `OutdatedHelperBanner.svelte`

**Files:**
- Create: `app/src/components/library-status/OutdatedHelperBanner.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- app/src/components/library-status/OutdatedHelperBanner.svelte -->
<script lang="ts">
  import { MIN_HELPER_VERSION } from '$lib/min-helper-version';

  /** Currently-detected helper version. */
  export let version: string;
</script>

<div class="outdated-helper" role="alert">
  <span>
    Your helper is outdated ({version}). Upgrade to {MIN_HELPER_VERSION}+ for faster fetch and the JWT-pair auth path.
  </span>
  <a class="outdated-helper__link" href="https://github.com/tenorune/bsky-saves#install" target="_blank" rel="noopener noreferrer">How to upgrade</a>
</div>

<style>
  .outdated-helper {
    margin: 0 0 0.6rem;
    padding: 0.5rem 0.7rem;
    border-radius: 6px;
    background: color-mix(in oklab, gold 18%, Canvas);
    border: 1px solid color-mix(in oklab, gold 40%, transparent);
    font-size: 0.875rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .outdated-helper__link {
    margin-left: auto;
    font-size: 0.8rem;
    color: inherit;
  }
</style>
```

- [ ] **Step 2: Type-check + Commit**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit`
Expected: clean.

```bash
cd /home/user/bsky-saves-gui
git add app/src/components/library-status/OutdatedHelperBanner.svelte
git commit -m "feat(library-status): OutdatedHelperBanner component"
```

---

### Task 8: `InstallHelperHint.svelte`

**Files:**
- Create: `app/src/components/library-status/InstallHelperHint.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- app/src/components/library-status/InstallHelperHint.svelte -->
<script lang="ts">
  import { dismissInstallHint } from '$lib/install-hint-pref';
</script>

<div class="install-hint">
  <span>
    Tip: install <code>bsky-saves</code> locally for faster fetch and built-in image &amp; article backup.
  </span>
  <a class="install-hint__link" href="https://github.com/tenorune/bsky-saves#install" target="_blank" rel="noopener noreferrer">How to install</a>
  <button type="button" class="install-hint__dismiss" on:click={dismissInstallHint}>Dismiss</button>
</div>

<style>
  .install-hint {
    margin-top: 0.6rem;
    padding-top: 0.5rem;
    border-top: 1px solid color-mix(in oklab, CanvasText 10%, transparent);
    font-size: 0.85rem;
    opacity: 0.75;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
  }
  .install-hint__link, .install-hint__dismiss {
    font: inherit;
    font-size: 0.8rem;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .install-hint__dismiss { margin-left: auto; }
</style>
```

- [ ] **Step 2: Type-check + Commit**

```bash
cd /home/user/bsky-saves-gui/app && npx tsc --noEmit
cd /home/user/bsky-saves-gui
git add app/src/components/library-status/InstallHelperHint.svelte
git commit -m "feat(library-status): InstallHelperHint component (with dismiss)"
```

---

## Phase D — `AssetRow` and `LibraryStatusPanel`

### Task 9: `AssetRow.svelte`

**Files:**
- Create: `app/src/components/library-status/AssetRow.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- app/src/components/library-status/AssetRow.svelte -->
<script lang="ts">
  /** Display label, e.g. "Threads". */
  export let label: string;
  /** Whether the asset toggle is on. */
  export let on: boolean;
  /** Whether a backend is available for this asset (false → "no backend available"). */
  export let backendAvailable: boolean;
  /** Per-row backend label, only rendered when it differs from the dominant. */
  export let backendLabel: string | null = null;
  /** Counts. total=null means "no count to show yet" (e.g., posts pre-fetch). */
  export let fetched: number | null = null;
  export let total: number | null = null;
  export let failed: number | null = null;
  /** Optional progress fraction 0..1 for the active phase. null = no progress bar. */
  export let progress: number | null = null;
  /** Set up callback shown when on && !backendAvailable. */
  export let onSetup: (() => void) | null = null;
  /** View failures callback shown when failed > 0. */
  export let onViewFailures: (() => void) | null = null;
</script>

<div class="row">
  <span class="label">{label}</span>
  {#if !on}
    <span class="badge badge--off">off</span>
  {:else if !backendAvailable}
    <span class="needs-setup">no backend available</span>
    {#if onSetup}
      <button type="button" class="action-link" on:click={onSetup}>Set up</button>
    {/if}
  {:else}
    <span class="badge badge--on">on</span>
    {#if total !== null && fetched !== null}
      <span>
        {fetched} of {total}
        {#if failed && failed > 0}
          <span class="muted">(<span class="inline-error">{failed} failed</span>{#if onViewFailures} · <button type="button" class="action-link" on:click={onViewFailures}>view</button>{/if})</span>
        {/if}
      </span>
    {/if}
    {#if backendLabel}
      <span class="backend">via {backendLabel}</span>
    {/if}
    {#if progress !== null}
      <div class="progress-bar"><span style="width: {Math.round(progress * 100)}%"></span></div>
    {/if}
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: baseline;
  }
  .row + .row { margin-top: 0.4rem; }
  .label { font-weight: 600; min-width: 4.5rem; display: inline-block; }
  .muted { opacity: 0.7; }
  .badge {
    font-size: 0.75rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    color: color-mix(in oklab, CanvasText 75%, Canvas);
  }
  .badge--on {
    background: color-mix(in oklab, mediumseagreen 18%, Canvas);
    border-color: color-mix(in oklab, mediumseagreen 35%, transparent);
  }
  .badge--off { opacity: 0.55; }
  .progress-bar {
    flex-basis: 100%;
    height: 4px;
    margin-top: 0.35rem;
    background: color-mix(in oklab, CanvasText 12%, transparent);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-bar > span {
    display: block;
    height: 100%;
    background: color-mix(in oklab, royalblue 60%, CanvasText);
    border-radius: 999px;
  }
  .backend { font-size: 0.8rem; opacity: 0.7; }
  .needs-setup {
    color: color-mix(in oklab, CanvasText 65%, Canvas);
    font-style: italic;
  }
  .inline-error { color: color-mix(in oklab, red 75%, CanvasText); }
  .action-link {
    font: inherit;
    font-size: 0.8rem;
    background: none;
    border: 0;
    padding: 0.1rem 0.25rem;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
```

- [ ] **Step 2: Type-check + Commit**

```bash
cd /home/user/bsky-saves-gui/app && npx tsc --noEmit
cd /home/user/bsky-saves-gui
git add app/src/components/library-status/AssetRow.svelte
git commit -m "feat(library-status): AssetRow presentational component"
```

---

### Task 10: `LibraryStatusPanel.svelte`

**Files:**
- Create: `app/src/components/LibraryStatusPanel.svelte`

This is the composition layer. It subscribes to: `libraryRefreshState`, `capabilitySnapshot`, `assetToggles`, `installHintDismissed`, `imageHydration`, `articleHydration`, `threadProgress`, `fetchProgress`, `enrichProgress`. It computes per-row props and renders banners.

- [ ] **Step 1: Implement**

```svelte
<!-- app/src/components/LibraryStatusPanel.svelte -->
<script lang="ts">
  import { capabilitySnapshot } from '$lib/capability-snapshot';
  import { assetToggles } from '$lib/asset-toggles';
  import { installHintDismissed } from '$lib/install-hint-pref';
  import { libraryRefreshState } from '$lib/library-refresh';
  import { imageHydration, articleHydration, threadProgress, fetchProgress, enrichProgress } from '$lib/hydration-state';
  import { computeDominantBackend } from '$lib/dominant-backend';
  import { MIN_HELPER_VERSION, isHelperOutdated } from '$lib/min-helper-version';
  import AssetRow from './library-status/AssetRow.svelte';
  import AuthErrorBanner from './library-status/AuthErrorBanner.svelte';
  import OutdatedHelperBanner from './library-status/OutdatedHelperBanner.svelte';
  import InstallHelperHint from './library-status/InstallHelperHint.svelte';

  /** Optional callbacks the parent can pass; if undefined, the row hides the affordance. */
  export let onSetupImages: (() => void) | null = null;
  export let onSetupArticles: (() => void) | null = null;
  export let onViewImageFailures: (() => void) | null = null;
  export let onViewArticleFailures: (() => void) | null = null;

  $: snap = $capabilitySnapshot;
  $: toggles = $assetToggles;
  $: dominantBackend = computeDominantBackend(snap);

  // Per-row backend label: only when it differs from the dominant.
  function labelFor(kind: string): string | null {
    switch (kind) {
      case 'helper': return 'local helper';
      case 'user-worker': return 'your worker proxy';
      case 'operator-worker': return "operator's worker proxy";
      default: return null;
    }
  }
  function rowBackend(kind: string): string | null {
    const own = labelFor(kind);
    if (!own) return null;
    if (own === dominantBackend) return null;
    return own;
  }

  $: outdated =
    snap.helper.detected && isHelperOutdated(snap.helper.version);
  $: helperVersion = snap.helper.detected ? snap.helper.version : '';
  $: pyodideOnly = !snap.helper.detected;

  // Threads
  $: threadsBackendAvailable = snap.threads.kind !== 'pyodide' || true; // pyodide is always available
  $: threadsRunning = $threadProgress.status === 'running';
  $: threadsTotal = $threadProgress.total || null;
  $: threadsFetched = $threadProgress.fetched || null;
  $: threadsFailed = $threadProgress.failed;
  $: threadsProgress = threadsRunning && threadsTotal ? Math.min(1, ($threadProgress.fetched ?? 0) / threadsTotal) : null;

  // Images
  $: imagesBackendAvailable = snap.images.kind !== 'none';
  $: imagesRunning = $imageHydration.status === 'running';
  $: imagesTotal = $imageHydration.total || null;
  $: imagesFetched = $imageHydration.fetched || null;
  $: imagesFailed = $imageHydration.failed;
  $: imagesProgress = imagesRunning && imagesTotal ? Math.min(1, ($imageHydration.fetched ?? 0) / imagesTotal) : null;

  // Articles
  $: articlesBackendAvailable = snap.articles.kind !== 'none';
  $: articlesRunning = $articleHydration.status === 'running';
  $: articlesTotal = $articleHydration.total || null;
  $: articlesFetched = $articleHydration.fetched || null;
  $: articlesFailed = $articleHydration.failed;
  $: articlesProgress = articlesRunning && articlesTotal ? Math.min(1, ($articleHydration.fetched ?? 0) / articlesTotal) : null;

  $: refreshState = $libraryRefreshState;
</script>

<section class="status-panel" aria-label="Library status">
  {#if refreshState.status === 'error'}
    <AuthErrorBanner message={refreshState.error} />
  {/if}
  {#if outdated}
    <OutdatedHelperBanner version={helperVersion} />
  {/if}

  <AssetRow
    label="Threads"
    on={toggles.threads}
    backendAvailable={true}
    backendLabel={rowBackend(snap.threads.kind)}
    fetched={threadsFetched}
    total={threadsTotal}
    failed={threadsFailed}
    progress={threadsProgress}
  />
  <AssetRow
    label="Images"
    on={toggles.images}
    backendAvailable={imagesBackendAvailable}
    backendLabel={rowBackend(snap.images.kind)}
    fetched={imagesFetched}
    total={imagesTotal}
    failed={imagesFailed}
    progress={imagesProgress}
    onSetup={onSetupImages}
    onViewFailures={onViewImageFailures}
  />
  <AssetRow
    label="Articles"
    on={toggles.articles}
    backendAvailable={articlesBackendAvailable}
    backendLabel={rowBackend(snap.articles.kind)}
    fetched={articlesFetched}
    total={articlesTotal}
    failed={articlesFailed}
    progress={articlesProgress}
    onSetup={onSetupArticles}
    onViewFailures={onViewArticleFailures}
  />

  {#if pyodideOnly && !$installHintDismissed}
    <InstallHelperHint />
  {/if}
</section>

<style>
  .status-panel {
    padding: 0.6rem 1rem;
    background: color-mix(in oklab, CanvasText 4%, Canvas);
    border-bottom: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
    font-size: 0.875rem;
  }
</style>
```

(`dominantBackend` is exported but not displayed in this component — Library renders it in the header. It's referenced in `rowBackend()`.)

- [ ] **Step 2: Type-check**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/components/LibraryStatusPanel.svelte
git commit -m "feat(library-status): LibraryStatusPanel composition"
```

---

## Phase E — Library page integration

### Task 11: Update Library.svelte to use LibraryStatusPanel + Refresh button

**Files:**
- Modify: `app/src/routes/Library.svelte`

- [ ] **Step 1: Replace the body of `app/src/routes/Library.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { inventoryState, loadFromDb } from '$lib/inventory-loader';
  import { lastSession } from '$lib/last-session';
  import { signInDraft } from '$lib/sign-in-draft';
  import { navigate } from '$lib/router';
  import { slideFromRight } from '$lib/slide-transition';
  import { startLibraryRefresh, stopLibraryRefresh, libraryRefreshState } from '$lib/library-refresh';
  import { assetToggles } from '$lib/asset-toggles';
  import { capabilitySnapshot } from '$lib/capability-snapshot';
  import { computeDominantBackend } from '$lib/dominant-backend';
  import LibraryView from '../reader/LibraryView.svelte';
  import LibraryStatusPanel from '../components/LibraryStatusPanel.svelte';
  import CustomProxySetupModal from '../components/CustomProxySetupModal.svelte';
  import { rkeyOf } from '../reader/inventory-shape';
  import type { Save } from '../reader/inventory-shape';
  import { restoreHydrationFromInventory } from '$lib/restore-hydration';

  let setupOpen = false;

  onMount(async () => {
    if (get(inventoryState).status === 'loading') {
      await loadFromDb();
    }
    const s = get(inventoryState);
    if (s.status === 'ready') {
      await restoreHydrationFromInventory(s.inventory);
    }
  });

  function open(save: Save): void {
    navigate(`/post/${rkeyOf(save.uri)}`);
  }

  function refresh(): void {
    const draft = get(signInDraft);
    const session = get(lastSession);
    const toggles = get(assetToggles);

    if (draft && draft.appPassword) {
      // Password mode (fresh sign-in)
      startLibraryRefresh({
        credentials: { handle: draft.handle, appPassword: draft.appPassword, pds: draft.pds },
        includeThreads: toggles.threads,
      });
    } else if (session) {
      // Session mode (JWT-pair restore)
      startLibraryRefresh({
        credentials: {
          accessJwt: session.accessJwt,
          refreshJwt: session.refreshJwt,
          did: session.did,
          pds: session.pds,
        },
        includeThreads: toggles.threads,
      });
    } else {
      navigate('/');
    }
  }

  function stop(): void {
    stopLibraryRefresh();
  }

  $: snap = $capabilitySnapshot;
  $: dominantBackend = computeDominantBackend(snap);
  $: postCount = $inventoryState.status === 'ready' ? $inventoryState.inventory.saves.length : 0;
  $: refreshing = $libraryRefreshState.status === 'running';
</script>

<section class="route route--library" use:slideFromRight>
  <header class="route__header">
    <h2 class="route__title">
      Library
      {#if $inventoryState.status === 'ready'}
        <span class="route__count">— {postCount} posts</span>
      {/if}
    </h2>
    {#if dominantBackend}
      <span class="route__backend">via {dominantBackend}</span>
    {/if}
    {#if refreshing}
      <button type="button" class="route__refresh" on:click={stop}>Stop</button>
    {:else}
      <button type="button" class="route__refresh" on:click={refresh}>Refresh</button>
    {/if}
  </header>

  <LibraryStatusPanel
    onSetupImages={() => (setupOpen = true)}
    onSetupArticles={() => (setupOpen = true)}
  />

  {#if $inventoryState.status === 'loading'}
    <p>Loading inventory…</p>
  {:else if $inventoryState.status === 'empty'}
    <p>First fetch in progress…</p>
  {:else if $inventoryState.status === 'error'}
    <p>Failed to load inventory: {$inventoryState.message}</p>
  {:else}
    <LibraryView inventory={$inventoryState.inventory} on:open={(e) => open(e.detail)} />
  {/if}
</section>

<CustomProxySetupModal open={setupOpen} on:close={() => (setupOpen = false)} />

<style>
  .route--library { display: flex; flex-direction: column; }
  .route__header {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 12%, transparent);
  }
  .route__title { margin: 0; font-size: 1rem; flex: 1; }
  .route__count { font-weight: 400; opacity: 0.7; }
  .route__backend { font-size: 0.8rem; opacity: 0.7; margin-right: 0.5rem; }
  .route__refresh {
    font: inherit;
    font-size: 0.875rem;
    padding: 0.35rem 0.75rem;
    border: 1px solid color-mix(in oklab, CanvasText 25%, transparent);
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
</style>
```

- [ ] **Step 2: Type-check + run all tests**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit && npx vitest run`
Expected: clean + pass.

- [ ] **Step 3: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/routes/Library.svelte
git commit -m "feat(library): adopt LibraryStatusPanel + Refresh/Stop button"
```

---

## Phase F — Settings page

### Task 12: Add three on/off toggles to Settings

**Files:**
- Modify: `app/src/routes/Settings.svelte`

- [ ] **Step 1: Inspect existing Settings.svelte**

```bash
cat /home/user/bsky-saves-gui/app/src/routes/Settings.svelte
```

Identify a sensible insertion point — probably after any account-related section, before the proxy-config section. Note the existing styling conventions for fieldsets / labels.

- [ ] **Step 2: Add toggle UI**

Add to Settings.svelte:

```svelte
<script lang="ts">
  // ...existing imports...
  import { assetToggles, setAssetToggle, loadAssetToggles } from '$lib/asset-toggles';
  import { installHintDismissed, restoreInstallHint, loadInstallHintPref } from '$lib/install-hint-pref';
  import { onMount } from 'svelte';

  onMount(async () => {
    await loadAssetToggles();
    await loadInstallHintPref();
  });

  $: toggles = $assetToggles;
</script>

<!-- ... existing content ... -->

<section class="settings__section">
  <h3>Backups</h3>
  <p class="muted">Choose which kinds of backups Library should keep up to date.</p>
  <label>
    <input
      type="checkbox"
      checked={toggles.threads}
      on:change={(e) => setAssetToggle('threads', e.currentTarget.checked)}
    />
    Back up threads
  </label>
  <label>
    <input
      type="checkbox"
      checked={toggles.images}
      on:change={(e) => setAssetToggle('images', e.currentTarget.checked)}
    />
    Back up images
  </label>
  <label>
    <input
      type="checkbox"
      checked={toggles.articles}
      on:change={(e) => setAssetToggle('articles', e.currentTarget.checked)}
    />
    Back up articles
  </label>
</section>

{#if $installHintDismissed}
  <section class="settings__section">
    <h3>Install hint</h3>
    <button type="button" on:click={restoreInstallHint}>Show install-helper hint again</button>
  </section>
{/if}
```

(Match the existing styling — copy class names from neighboring sections.)

- [ ] **Step 3: Type-check + run all tests**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit && npx vitest run`
Expected: clean + pass.

- [ ] **Step 4: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/routes/Settings.svelte
git commit -m "feat(settings): three on/off toggles for threads/images/articles + install-hint reset"
```

---

### Task 13: Threads-toggle-on triggers thread hydration over existing inventory

**Files:**
- Modify: `app/src/lib/asset-toggles.ts`
- Modify: `app/src/lib/asset-toggles.test.ts`

When the user flips threads on (off→on), kick off `threadHydrator.start()` against the current inventory. This is the "threads becomes a state" behavior from Q9=B in the design.

- [ ] **Step 1: Write failing test**

Append to `app/src/lib/asset-toggles.test.ts`:

```ts
import { vi } from 'vitest';

describe('threads-toggle-on triggers thread hydration', () => {
  beforeEach(async () => {
    await clear();
    _resetAssetTogglesForTests();
  });

  it('calls onThreadsToggleOn when threads flips off→on', async () => {
    const onThreadsToggleOn = vi.fn();
    await setAssetToggle('threads', false, { onThreadsToggleOn });
    expect(onThreadsToggleOn).not.toHaveBeenCalled();
    await setAssetToggle('threads', true, { onThreadsToggleOn });
    expect(onThreadsToggleOn).toHaveBeenCalled();
  });

  it('does not call onThreadsToggleOn when threads is set to its existing value', async () => {
    const onThreadsToggleOn = vi.fn();
    await setAssetToggle('threads', true, { onThreadsToggleOn });
    expect(onThreadsToggleOn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `setAssetToggle` doesn't accept a second argument.

- [ ] **Step 3: Modify `setAssetToggle` to accept callbacks**

```ts
export interface SetAssetToggleDeps {
  readonly onThreadsToggleOn?: () => void;
}

export async function setAssetToggle(
  key: AssetKey,
  value: boolean,
  deps: SetAssetToggleDeps = {},
): Promise<void> {
  let prev = false;
  store.subscribe((v) => { prev = v[key]; })();
  store.update((cur) => ({ ...cur, [key]: value }));
  let snapshot: AssetTogglesShape = DEFAULTS;
  store.subscribe((v) => { snapshot = v; })();
  await idbSet(KEY, snapshot);
  if (key === 'threads' && value && !prev) {
    deps.onThreadsToggleOn?.();
  }
}
```

- [ ] **Step 4: Wire it up in Settings.svelte**

In Settings.svelte's threads checkbox, call:

```svelte
<input
  type="checkbox"
  checked={toggles.threads}
  on:change={(e) => setAssetToggle('threads', e.currentTarget.checked, {
    onThreadsToggleOn: triggerThreadHydration,
  })}
/>
```

Add a `triggerThreadHydration` function in Settings.svelte:

```ts
import { threadHydrator } from '$lib/thread-hydrator';
import { capabilitySnapshot } from '$lib/capability-snapshot';
import { config } from '$lib/config';
import { lastSession } from '$lib/last-session';
import { signInDraft } from '$lib/sign-in-draft';
import { loadInventory, saveInventory } from '$lib/inventory-store';

async function triggerThreadHydration(): Promise<void> {
  const inv = (await loadInventory()) as { saves: { uri: string }[] } | null;
  if (!inv) return;
  const draft = get(signInDraft);
  const session = get(lastSession);
  const credentials = draft?.appPassword
    ? { handle: draft.handle, appPassword: draft.appPassword, pds: draft.pds }
    : session
      ? { accessJwt: session.accessJwt, refreshJwt: session.refreshJwt, did: session.did, pds: session.pds }
      : null;
  if (!credentials) return;
  const out = await threadHydrator.start({
    backend: get(capabilitySnapshot).threads,
    origin: config.helperOrigin,
    inventory: inv,
    credentials,
  });
  await saveInventory(out);
}
```

- [ ] **Step 5: Run all tests**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit && npx vitest run`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/lib/asset-toggles.ts app/src/lib/asset-toggles.test.ts app/src/routes/Settings.svelte
git commit -m "feat(asset-toggles): threads-on flip triggers thread hydration over existing inventory"
```

---

## Phase G — SignIn flow change

### Task 14: SignIn submit → start refresh → navigate to Library

**Files:**
- Modify: `app/src/routes/SignIn.svelte`

- [ ] **Step 1: Locate the `submit()` function**

Currently `submit()` calls `signInDraft.set(...)` and then `navigate('/run')`. Replace the navigate target with `/library`, and kick off `startLibraryRefresh()` before navigating.

- [ ] **Step 2: Update submit()**

Find the `submit()` function in `app/src/routes/SignIn.svelte` and modify:

```ts
import { startLibraryRefresh } from '$lib/library-refresh';
import { assetToggles } from '$lib/asset-toggles';

function submit() {
  // ... existing validation ...

  signInDraft.set({
    handle, appPassword, pds, fetch: true, threads, saveInventory, saveCredentials, passphrase,
  });

  startLibraryRefresh({
    credentials: { handle, appPassword, pds },
    includeThreads: get(assetToggles).threads,
  });

  navigate('/library');
}
```

(Note: the original signInDraft fields like `fetch`, `threads`, `saveInventory` are no longer driving anything once Run/Refresh routes are gone, but keep them in the draft for now to avoid breaking other consumers. They become dead fields in this commit; cleanup later if desired.)

- [ ] **Step 3: Type-check + run all tests**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit && npx vitest run`
Expected: pass.

- [ ] **Step 4: Manual smoke (after-the-fact)**

This is a UX path — exercise it later. Don't block on it.

- [ ] **Step 5: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/routes/SignIn.svelte
git commit -m "feat(sign-in): submit triggers background refresh and navigates to Library"
```

---

## Phase H — Route deletion + cleanup

### Task 15: Remove `/run` and `/refresh` from the router

**Files:**
- Modify: `app/src/lib/routes.ts`
- Modify: `app/src/lib/router.ts`

- [ ] **Step 1: Update routes.ts**

```ts
// app/src/lib/routes.ts
import type { ComponentType } from 'svelte';
import SignIn from '$routes/SignIn.svelte';
import Library from '$routes/Library.svelte';
import Post from '$routes/Post.svelte';
import Settings from '$routes/Settings.svelte';
import Privacy from '$routes/Privacy.svelte';
import NotFound from '$routes/NotFound.svelte';

export interface RouteDef {
  readonly name: string;
  readonly pattern: RegExp;
  readonly paramNames: readonly string[];
  readonly component: ComponentType;
}

export const routes: readonly RouteDef[] = [
  { name: 'sign-in', pattern: /^\/$/, paramNames: [], component: SignIn },
  { name: 'library', pattern: /^\/library$/, paramNames: [], component: Library },
  { name: 'post', pattern: /^\/post\/([^/]+)$/, paramNames: ['rkey'], component: Post },
  { name: 'settings', pattern: /^\/settings$/, paramNames: [], component: Settings },
  { name: 'privacy', pattern: /^\/privacy$/, paramNames: [], component: Privacy },
];

export const notFoundRoute: RouteDef = {
  name: 'not-found',
  pattern: /.*/,
  paramNames: [],
  component: NotFound,
};
```

- [ ] **Step 2: Add redirects in router.ts**

Modify `parsePath()` in `app/src/lib/router.ts` to redirect legacy paths:

```ts
function parsePath(path: string): ActiveRoute {
  let normalized = path.length === 0 || path === '/' ? '/' : path;
  // Legacy redirects (kept for stale bookmarks).
  if (normalized === '/run' || normalized === '/refresh') {
    normalized = '/library';
    if (typeof window !== 'undefined') {
      window.location.hash = '#/library';
    }
  }
  for (const def of routes) {
    // ... existing body ...
  }
  // ...
}
```

- [ ] **Step 3: Type-check**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit`
Expected: clean.

(Tests for router will need updating if they exist; check `app/src/lib/router.test.ts`.)

- [ ] **Step 4: Run all tests**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run`

If router.test.ts references `/run` or `/refresh`, remove or update those tests. Add a test for the redirect:

```ts
it('redirects /run to /library', () => {
  // Use whatever pattern the existing router tests use to set a path.
});
```

- [ ] **Step 5: Commit**

```bash
cd /home/user/bsky-saves-gui
git add app/src/lib/routes.ts app/src/lib/router.ts app/src/lib/router.test.ts
git commit -m "feat(router): remove /run and /refresh routes; redirect to /library"
```

---

### Task 16: Delete Run.svelte and Refresh.svelte

**Files:**
- Delete: `app/src/routes/Run.svelte`
- Delete: `app/src/routes/Refresh.svelte`

- [ ] **Step 1: Verify no imports remain**

```bash
grep -rn "Run.svelte\|Refresh.svelte" app/src --include="*.ts" --include="*.svelte" | grep -v "Run.svelte:" | grep -v "Refresh.svelte:"
```

Expected: no matches (routes.ts already updated in Task 15).

- [ ] **Step 2: Delete**

```bash
cd /home/user/bsky-saves-gui
rm app/src/routes/Run.svelte app/src/routes/Refresh.svelte
```

- [ ] **Step 3: Type-check + tests**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit && npx vitest run`
Expected: clean + pass.

- [ ] **Step 4: Commit**

```bash
cd /home/user/bsky-saves-gui
git add -A app/src/routes/Run.svelte app/src/routes/Refresh.svelte
git commit -m "chore: delete Run.svelte and Refresh.svelte (replaced by Library hub)"
```

---

### Task 17: Delete engine.ts and engine.test.ts

**Files:**
- Delete: `app/src/lib/engine.ts`
- Delete: `app/src/lib/engine.test.ts`

- [ ] **Step 1: Verify no imports remain**

```bash
grep -rn "from '\$lib/engine'\|from './engine'\|from '../lib/engine'" app/src --include="*.ts" --include="*.svelte"
```

Expected: no matches.

- [ ] **Step 2: Delete**

```bash
cd /home/user/bsky-saves-gui
rm app/src/lib/engine.ts app/src/lib/engine.test.ts
```

- [ ] **Step 3: Type-check + tests**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit && npx vitest run`
Expected: clean + pass.

- [ ] **Step 4: Commit**

```bash
cd /home/user/bsky-saves-gui
git add -A app/src/lib/engine.ts app/src/lib/engine.test.ts
git commit -m "chore: delete engine.ts (replaced by library-refresh.ts)"
```

---

### Task 18: Delete BackupBanner / ArticleBackupBanner / BackupStatusRow

**Files:**
- Delete: `app/src/components/BackupBanner.svelte`
- Delete: `app/src/components/ArticleBackupBanner.svelte`
- Delete: `app/src/components/BackupStatusRow.svelte`

- [ ] **Step 1: Verify no imports remain**

```bash
grep -rn "BackupBanner\|ArticleBackupBanner\|BackupStatusRow" app/src --include="*.ts" --include="*.svelte" | grep -v "BackupBanner.svelte:" | grep -v "ArticleBackupBanner.svelte:" | grep -v "BackupStatusRow.svelte:"
```

Expected: no matches (Library.svelte was updated in Task 11).

- [ ] **Step 2: Delete**

```bash
cd /home/user/bsky-saves-gui
rm app/src/components/BackupBanner.svelte
rm app/src/components/ArticleBackupBanner.svelte
rm app/src/components/BackupStatusRow.svelte
```

- [ ] **Step 3: Type-check + tests**

Run: `cd /home/user/bsky-saves-gui/app && npx tsc --noEmit && npx vitest run`

Component-level tests for these (if any) also need deleting. Check:

```bash
find app/src/components -name "BackupBanner.test*" -o -name "ArticleBackupBanner.test*" -o -name "BackupStatusRow.test*"
```

- [ ] **Step 4: Commit**

```bash
cd /home/user/bsky-saves-gui
git add -A app/src/components/
git commit -m "chore: delete BackupBanner / ArticleBackupBanner / BackupStatusRow (replaced by LibraryStatusPanel)"
```

---

### Task 19: Delete the mockup directory

**Files:**
- Delete: `app/public/mockups/`

- [ ] **Step 1: Verify nothing references it**

```bash
grep -rn "mockups" app/src --include="*.ts" --include="*.svelte"
```

Expected: no matches.

- [ ] **Step 2: Delete**

```bash
cd /home/user/bsky-saves-gui
rm -rf app/public/mockups/
```

- [ ] **Step 3: Commit**

```bash
cd /home/user/bsky-saves-gui
git add -A app/public/mockups/
git commit -m "chore: delete library-status mockup directory (Plan 2 done)"
```

---

## Phase I — Final verification

### Task 20: Full test pass + manual smoke

**Files:** none.

- [ ] **Step 1: Run the entire suite**

Run: `cd /home/user/bsky-saves-gui/app && npx vitest run && npx tsc --noEmit`
Expected: all pass; type-check clean.

- [ ] **Step 2: Manual smoke**

If a `bsky-saves` v0.4.1+ helper is running locally:
1. `cd /home/user/bsky-saves-gui/app && npm run dev`
2. Navigate to `/`. Sign in with valid credentials.
3. Confirm: SignIn submits → page navigates to `/library` immediately. Background fetch starts.
4. Library page shows the status panel with three asset rows; counts increment as hydrators run.
5. Click "Refresh" again — confirms re-runs cleanly. Click "Stop" mid-run — confirms refresh state returns to idle.
6. Toggle "Back up threads" off in Settings, then refresh — confirm threads row reads `off` and threadHydrator isn't called.
7. Toggle "Back up threads" back on — confirm thread hydration kicks off automatically over existing inventory.
8. Visit `/run` — confirm redirect to `/library`. Same for `/refresh`.

If everything passes, Plan 2 is complete.

- [ ] **Step 3: Final push**

```bash
cd /home/user/bsky-saves-gui
git push origin main
```

---

## Spec coverage check

| Spec section | Covered by |
|---|---|
| §3 User-visible changes (sign-in flow) | Task 14 (SignIn redirect). |
| §3 User-visible changes (Library hub + status panel + Refresh/Stop) | Tasks 9, 10, 11. |
| §3 User-visible changes (Settings toggles + install-hint reset) | Tasks 1, 2, 12, 13. |
| §3 User-visible changes (route removal) | Tasks 15, 16. |
| §6 Hydrators (existing migrated to CapabilitySnapshot) | Done in Plan 1. |
| §11 Library status panel visual contract | Tasks 6–11. |
| §12 Migration / deletions | Tasks 15–19. |
| §15 Out of scope | Confirmed (no /run endpoint, no streaming progress, no auto-install). |
| §17 Acceptance criteria | Task 20. |
