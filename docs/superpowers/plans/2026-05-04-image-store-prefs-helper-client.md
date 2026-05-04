# Plan 2: Image-blob store, backup preferences, and helper client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land three small, isolated foundation modules needed by every later piece of image and article backup.

**Architecture:** All three modules are self-contained TypeScript libraries with no UI. Each is independently testable with idb-keyval's in-memory adapter (`fake-indexeddb/auto`) plus mocked fetch. They have no consumers in this plan — Plans 3+ wire them into the GUI.

**Tech Stack:** Svelte 4, TypeScript 5, Vitest 2, idb-keyval (already a dep).

**Spec reference:** `docs/superpowers/specs/2026-05-04-hydration-and-backup-ux-design.md` — sections "Layered backend strategy", "Background hydration", and "Permanent dismissals". Helper API per `docs/bsky-saves-serve-requirements.md`.

**Out of scope (later plans):**
- User-worker client and operator-proxy client (Plan 3).
- Backend resolver / fetcher (Plan 3).
- Hydration state and loop (Plan 4).
- Any UI (Plans 5+).

**Working directory:** `/home/user/bsky-saves-gui`. Branch: `main`. HEAD should be `8e08bb1` (Plan 1 polish commit) or later.

---

## Task 1: IDB-backed image-blob store

A keyval store that maps image URL → Blob, kept in its own IndexedDB database so `Settings → Clear all local data` can wipe it without touching the inventory.

**Files:**
- Create: `app/src/lib/image-store.ts`
- Create: `app/src/lib/image-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/image-store.test.ts` with this content:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
});

describe('image-store', () => {
  it('round-trips a Blob keyed by URL', async () => {
    const { saveImageBlob, loadImageBlob } = await import('./image-store');
    const blob = new Blob(['hello'], { type: 'image/png' });
    await saveImageBlob('https://x/a.png', blob);
    const got = await loadImageBlob('https://x/a.png');
    expect(got).toBeDefined();
    expect(got!.type).toBe('image/png');
    expect(got!.size).toBe(5);
  });

  it('returns undefined for an unknown URL', async () => {
    const { loadImageBlob } = await import('./image-store');
    const got = await loadImageBlob('https://x/missing.png');
    expect(got).toBeUndefined();
  });

  it('hasImageBlob is true after save, false after delete', async () => {
    const { saveImageBlob, hasImageBlob, deleteImageBlob } = await import('./image-store');
    await saveImageBlob('https://x/b.png', new Blob([''], { type: 'image/png' }));
    expect(await hasImageBlob('https://x/b.png')).toBe(true);
    await deleteImageBlob('https://x/b.png');
    expect(await hasImageBlob('https://x/b.png')).toBe(false);
  });

  it('imageBlobCount reports the right number', async () => {
    const { saveImageBlob, imageBlobCount } = await import('./image-store');
    expect(await imageBlobCount()).toBe(0);
    await saveImageBlob('https://x/1', new Blob([''], { type: 'image/png' }));
    await saveImageBlob('https://x/2', new Blob([''], { type: 'image/png' }));
    expect(await imageBlobCount()).toBe(2);
  });

  it('clearImageBlobs empties the store', async () => {
    const { saveImageBlob, clearImageBlobs, imageBlobCount } = await import('./image-store');
    await saveImageBlob('https://x/a', new Blob([''], { type: 'image/png' }));
    await clearImageBlobs();
    expect(await imageBlobCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test image-store`

Expected: failures because `./image-store` doesn't exist yet.

- [ ] **Step 3: Implement the module**

Create `app/src/lib/image-store.ts` with this content:

```ts
// IndexedDB-backed store for hydrated image blobs. Keyed by remote URL so
// render-time lookups are a direct get(url). Lives in its own object store so
// Settings → "Clear all local data" can drop it without touching the inventory.

import { createStore, get, set, del, clear, keys } from 'idb-keyval';

const store = createStore('bsky-saves:images', 'blobs');

export async function saveImageBlob(url: string, blob: Blob): Promise<void> {
  await set(url, blob, store);
}

export async function loadImageBlob(url: string): Promise<Blob | undefined> {
  return get<Blob>(url, store);
}

export async function hasImageBlob(url: string): Promise<boolean> {
  return (await get(url, store)) !== undefined;
}

export async function imageBlobCount(): Promise<number> {
  return (await keys(store)).length;
}

export async function deleteImageBlob(url: string): Promise<void> {
  await del(url, store);
}

export async function clearImageBlobs(): Promise<void> {
  await clear(store);
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `pnpm test image-store`

Expected: all 5 tests passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 type errors. All previous tests still pass (count goes from 67 → 72).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(image-store): IDB-backed blob store keyed by URL"
```

Do not push.

---

## Task 2: Backup preferences module

Persists per-feature banner state: snooze-until timestamps and "don't ask me again" flags. Lives in IndexedDB so it survives reloads but goes away with `Clear all local data`.

**Files:**
- Create: `app/src/lib/backup-prefs.ts`
- Create: `app/src/lib/backup-prefs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/backup-prefs.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearBackupPrefs } = await import('./backup-prefs');
  await clearBackupPrefs();
  vi.useRealTimers();
});

describe('backup-prefs', () => {
  it('returns defaults when nothing is set', async () => {
    const { loadBackupPrefs } = await import('./backup-prefs');
    expect(await loadBackupPrefs()).toEqual({
      images: { snoozeUntil: null, dontAsk: false },
      articles: { snoozeUntil: null, dontAsk: false },
    });
  });

  it('snoozes a feature for 7 days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
    const { snoozeBackupPrompt, loadBackupPrefs } = await import('./backup-prefs');
    await snoozeBackupPrompt('images');
    const prefs = await loadBackupPrefs();
    const seven = 7 * 24 * 60 * 60 * 1000;
    expect(prefs.images.snoozeUntil).toBe(Date.parse('2026-05-04T00:00:00Z') + seven);
    expect(prefs.images.dontAsk).toBe(false);
  });

  it('"don\'t ask me again" is sticky across reads', async () => {
    const { setBackupDontAsk, loadBackupPrefs } = await import('./backup-prefs');
    await setBackupDontAsk('articles', true);
    expect((await loadBackupPrefs()).articles.dontAsk).toBe(true);
    await setBackupDontAsk('articles', false);
    expect((await loadBackupPrefs()).articles.dontAsk).toBe(false);
  });

  it('shouldShowBackupBanner is true when neither flag suppresses it', async () => {
    const { shouldShowBackupBanner } = await import('./backup-prefs');
    expect(await shouldShowBackupBanner('images')).toBe(true);
  });

  it('shouldShowBackupBanner is false while snoozed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
    const { snoozeBackupPrompt, shouldShowBackupBanner } = await import('./backup-prefs');
    await snoozeBackupPrompt('images');
    expect(await shouldShowBackupBanner('images')).toBe(false);
  });

  it('shouldShowBackupBanner is true again after the snooze elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
    const { snoozeBackupPrompt, shouldShowBackupBanner } = await import('./backup-prefs');
    await snoozeBackupPrompt('images');
    vi.setSystemTime(new Date('2026-05-12T00:00:01Z'));
    expect(await shouldShowBackupBanner('images')).toBe(true);
  });

  it('shouldShowBackupBanner is false when dontAsk is set, regardless of snooze', async () => {
    const { setBackupDontAsk, shouldShowBackupBanner } = await import('./backup-prefs');
    await setBackupDontAsk('images', true);
    expect(await shouldShowBackupBanner('images')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with module-not-found**

Run: `pnpm test backup-prefs`

Expected: failures because `./backup-prefs` doesn't exist.

- [ ] **Step 3: Implement the module**

Create `app/src/lib/backup-prefs.ts`:

```ts
// Per-feature banner state. Records when the user last said "Remind me later"
// and whether they ticked "Don't ask me again". Used by the Library's
// just-in-time backup banners and mirrored as toggles in Settings.

import { get, set, del } from 'idb-keyval';

export type BackupFeature = 'images' | 'articles';

export interface FeaturePrefs {
  readonly snoozeUntil: number | null; // epoch ms; null means never snoozed
  readonly dontAsk: boolean;
}

export interface BackupPrefs {
  readonly images: FeaturePrefs;
  readonly articles: FeaturePrefs;
}

const KEY = 'backup-prefs:v1';
const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;

const DEFAULTS: BackupPrefs = Object.freeze({
  images: { snoozeUntil: null, dontAsk: false },
  articles: { snoozeUntil: null, dontAsk: false },
});

function isFeaturePrefs(v: unknown): v is FeaturePrefs {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    (r.snoozeUntil === null || typeof r.snoozeUntil === 'number') &&
    typeof r.dontAsk === 'boolean'
  );
}

function isBackupPrefs(v: unknown): v is BackupPrefs {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return isFeaturePrefs(r.images) && isFeaturePrefs(r.articles);
}

export async function loadBackupPrefs(): Promise<BackupPrefs> {
  const raw = await get(KEY);
  return isBackupPrefs(raw) ? raw : DEFAULTS;
}

async function saveBackupPrefs(p: BackupPrefs): Promise<void> {
  await set(KEY, p);
}

export async function snoozeBackupPrompt(feature: BackupFeature): Promise<void> {
  const prefs = await loadBackupPrefs();
  const next: BackupPrefs = {
    ...prefs,
    [feature]: { ...prefs[feature], snoozeUntil: Date.now() + SNOOZE_MS },
  };
  await saveBackupPrefs(next);
}

export async function setBackupDontAsk(
  feature: BackupFeature,
  dontAsk: boolean,
): Promise<void> {
  const prefs = await loadBackupPrefs();
  const next: BackupPrefs = {
    ...prefs,
    [feature]: { ...prefs[feature], dontAsk },
  };
  await saveBackupPrefs(next);
}

export async function shouldShowBackupBanner(feature: BackupFeature): Promise<boolean> {
  const prefs = await loadBackupPrefs();
  const f = prefs[feature];
  if (f.dontAsk) return false;
  if (f.snoozeUntil !== null && Date.now() < f.snoozeUntil) return false;
  return true;
}

export async function clearBackupPrefs(): Promise<void> {
  await del(KEY);
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `pnpm test backup-prefs`

Expected: 7 tests passing.

- [ ] **Step 5: Run full type check + tests**

Run: `pnpm check && pnpm test`

Expected: 0 type errors. All previous tests still pass (count goes up by 7 to 79).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(backup-prefs): per-feature snooze + don't-ask state in IDB"
```

Do not push.

---

## Task 3: Helper client aligned to `bsky-saves serve` /ping spec

Replace the existing `helper-detector.ts` (which probes `/health` against an older speculative API) with a new `helper-client.ts` that matches the just-specced `bsky-saves serve` daemon: probes `GET /ping` and returns a typed result with name, version, and feature list.

The detector's old `/health` shape doesn't match anything that will actually exist; replacing it now is cleaner than carrying a deprecated path.

**Files:**
- Create: `app/src/lib/helper-client.ts`
- Create: `app/src/lib/helper-client.test.ts`
- Delete: `app/src/lib/helper-detector.ts`
- Delete: `app/src/lib/helper-detector.test.ts`
- Modify: `.env.example` — change default `VITE_HELPER_ORIGIN` to `http://127.0.0.1:47826` (per the bsky-saves serve requirements doc).
- Modify: `.env` — same change so the local dev environment matches.
- Modify: any consumers of `helper-detector.ts` (search the repo to find them; likely none after Plan 1 cleanup, but verify).

- [ ] **Step 1: Find consumers of `helper-detector.ts`**

Run: `grep -rn "helper-detector\|detectHelper\|HelperStatus" app/src`

Expected: only matches inside `app/src/lib/helper-detector.ts` and `app/src/lib/helper-detector.test.ts` themselves. If any other file imports the module, that file needs updating in this task too — report and pause for guidance before continuing.

- [ ] **Step 2: Write the failing tests**

Create `app/src/lib/helper-client.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('helper-client probeHelper', () => {
  it('reports available with version + features when /ping returns the expected JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          name: 'bsky-saves',
          version: '0.2.4',
          features: ['fetch-image', 'extract-article'],
        }),
      })),
    );
    const { probeHelper } = await import('./helper-client');
    const result = await probeHelper('http://127.0.0.1:47826');
    expect(result).toEqual({
      status: 'available',
      version: '0.2.4',
      features: ['fetch-image', 'extract-article'],
    });
  });

  it('reports unavailable when /ping returns a non-bsky-saves payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: 'something-else' }),
      })),
    );
    const { probeHelper } = await import('./helper-client');
    expect(await probeHelper('http://127.0.0.1:47826')).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when /ping returns non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const { probeHelper } = await import('./helper-client');
    expect(await probeHelper('http://127.0.0.1:47826')).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when fetch rejects (no helper running)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { probeHelper } = await import('./helper-client');
    expect(await probeHelper('http://127.0.0.1:47826')).toEqual({ status: 'unavailable' });
  });

  it('strips a trailing slash from the origin before appending /ping', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { probeHelper } = await import('./helper-client');
    await probeHelper('http://127.0.0.1:47826/');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:47826/ping', expect.any(Object));
  });
});
```

- [ ] **Step 3: Run tests — confirm they fail with module-not-found**

Run: `pnpm test helper-client`

Expected: failures because `./helper-client` doesn't exist.

- [ ] **Step 4: Implement the module**

Create `app/src/lib/helper-client.ts`:

```ts
// Client for the local bsky-saves serve daemon. Speaks the API specified in
// docs/bsky-saves-serve-requirements.md: GET /ping for capability detection,
// POST /fetch-image for byte fetching (added in a later plan).

import { config } from './config';

export type HelperStatus =
  | { status: 'available'; version: string; features: readonly string[] }
  | { status: 'unavailable' };

interface PingPayload {
  readonly name: string;
  readonly version: string;
  readonly features: readonly string[];
}

function isPingPayload(v: unknown): v is PingPayload {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    r.name === 'bsky-saves' &&
    typeof r.version === 'string' &&
    Array.isArray(r.features) &&
    r.features.every((f) => typeof f === 'string')
  );
}

/**
 * Probe the helper daemon at the given origin. Resolves with a capability
 * report when the daemon is reachable and identifies as bsky-saves; otherwise
 * resolves with `{ status: 'unavailable' }`.
 *
 * Never throws.
 */
export async function probeHelper(origin: string): Promise<HelperStatus> {
  const base = origin.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/ping`, { method: 'GET' });
    if (!res.ok) return { status: 'unavailable' };
    const body = (await res.json()) as unknown;
    if (!isPingPayload(body)) return { status: 'unavailable' };
    return {
      status: 'available',
      version: body.version,
      features: body.features,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Probe the configured helper origin (`VITE_HELPER_ORIGIN`).
 */
export function probeConfiguredHelper(): Promise<HelperStatus> {
  return probeHelper(config.helperOrigin);
}
```

- [ ] **Step 5: Update `.env.example` and `.env` to the new default port**

The bsky-saves serve requirements doc specifies `47826` as the default port. Update both files to match.

In `.env.example`, change:

```
VITE_HELPER_ORIGIN=http://127.0.0.1:7878
```

to:

```
VITE_HELPER_ORIGIN=http://127.0.0.1:47826
```

In `.env`, do the same change (the local dev environment file should mirror the example).

- [ ] **Step 6: Delete the old detector files**

Run:

```bash
rm app/src/lib/helper-detector.ts app/src/lib/helper-detector.test.ts
```

- [ ] **Step 7: Run tests — confirm new client passes and old detector tests are gone**

Run: `pnpm test helper-client`

Expected: 5 tests passing in `helper-client.test.ts`.

Run: `pnpm test`

Expected: 0 errors. Total test count goes up by 5 (helper-client) and down by 3 (the deleted helper-detector tests), net +2 from before this task.

- [ ] **Step 8: Run type check**

Run: `pnpm check`

Expected: 0 errors. The deleted `helper-detector.ts` had no consumers after Plan 1 (Step 1 verified this). If `pnpm check` flags an unresolved import, that means a consumer was missed in Step 1 — go back and update it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(helper-client): /ping-based detection per bsky-saves serve spec"
```

Do not push.

---

## Final verification

- [ ] **Step 1: Run check + test + build**

```bash
pnpm check && pnpm test && pnpm build
```

Expected: 0 type errors (3 pre-existing CSS warnings about retained-for-Plan-2 selectors are tolerated). All tests pass. Both bundles build.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## What's next

Plan 3 will add the user-worker client (wrapping the existing cf-worker template's `POST /fetch`), the backend resolver (helper > user-worker priority), and the high-level `image-fetcher` that picks a backend and returns a Blob. After that, Plan 4 picks up hydration state and the background loop.
