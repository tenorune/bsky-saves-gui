# Status snapshot push (installer panel, phase 1) — design

> **Status:** drafting 2026-05-21. Contract is locked on coord repo (`docs/installer-status-panel.md`, §7 empty). This spec covers the GUI-side implementation.
> **Branch target:** `claude/status-snapshot-push` (feature branch off `main`; not the `coordination` branch).
> **Companion:** [`bsky-saves-coordination:docs/installer-status-panel.md`](https://github.com/tenorune/bsky-saves-coordination/blob/main/docs/installer-status-panel.md). The contract is authoritative for endpoint shape, payload shape, debounce floor, TTL value, and auth model. This spec maps that contract onto our codebase.

---

## 1. Summary

Add a `POST /status` push pipeline to `bsky-saves-gui` so the installer's tray panel can render live library state pulled from the local helper. Two new modules, `app/src/lib/status-payload.ts` (pure payload builder) and `app/src/lib/status-pusher.ts` (subscriptions + debouncer + heartbeat + beforeunload + `DELETE /status`). One line added in `main.ts` to bootstrap; one line added in `Settings.svelte` to wire "Clear all data" to `DELETE /status`. No changes to existing stores or hydrators.

## 2. Goals and non-goals

### Goals

- Implement the GUI's responsibilities under §4.3 of the contract: required triggers, session-mode heartbeat, persist-mode `beforeunload` final push, `DELETE /status` on "Clear all data".
- Compute the §4.4 payload from existing Svelte stores without modifying them.
- Reuse `helper-client.ts`'s bearer-token auth and 401 handling. No new auth surface.
- Pure payload builder isolatable for unit-testing payload-shape evolution.

### Non-goals

- Phase 2 command flow (panel → GUI commands). Separate doc when phase 2 lands.
- Phase 3 CLI-inventory integration.
- Any installer-side panel rendering — that's `bsky-saves-install`'s repo.
- Modifying the existing hydration / library-refresh / inventory code paths.
- A user-visible UI for status-push diagnostics (advanced developers can read the helper's `GET /status` directly).

## 3. Architecture

### 3.1 Modules

**`app/src/lib/status-payload.ts`** (~150 lines) — pure module.

```ts
export interface StatusSnapshotInputs {
  readonly inventoryState: InventoryStateValue;
  readonly libraryRefreshState: LibraryRefreshState;
  readonly fetchProgress: FetchProgress;
  readonly imageHydration: HydrationState;
  readonly articleHydration: HydrationState;
  readonly threadProgress: ThreadProgress;
  readonly persistenceMode: 'persist' | 'session';
  readonly lastSession: AtSession | null;
  readonly browserBytesEstimate: number | null;
  readonly priority?: 'final';  // beforeunload override
}

export function buildStatusPayload(inputs: StatusSnapshotInputs): StatusPayload | null;
```

Returns `null` when `lastSession === null` (nothing to push without a signed-in DID). Returns the §4.4-shaped object otherwise. No Svelte imports; no I/O. Testable by passing synthetic input literals.

**`app/src/lib/status-pusher.ts`** (~250 lines) — side-effecting orchestrator.

```ts
export function initStatusPusher(): void;     // called from main.ts
export async function deleteStatus(): Promise<void>;  // called from Settings.svelte
```

Internally subscribes to ten Svelte stores, maintains debouncer + heartbeat state, registers a `beforeunload` listener, owns the only knowledge of the `/status` endpoint URL.

### 3.2 Data flow

```
Svelte stores                  status-pusher                     helper
─────────────                  ─────────────                     ──────
inventoryState ──────┐
libraryRefreshState ─┤
fetchProgress ───────┤
imageHydration ──────┤        ┌──────────────────┐
articleHydration ────┼──.subscribe──►  debouncer  │  ──POST /status──►
threadProgress ──────┤        │  (500ms throttle)│
assetToggles ────────┤        │      + heartbeat │
persistenceMode ─────┤        │      (15s/session)│
pairingToken ────────┤        │      + beforeunload│
capabilitySnapshot ──┤        └──────────────────┘
helperOptOut ────────┤
lastSession ─────────┘
                              Settings."Clear all data" ──DELETE /status──►
```

## 4. Activation state machine

The pusher is always **mounted** (subscriptions live, listeners registered) but only **active** when ALL four conditions are true:

1. `$capabilitySnapshot.helper.detected === true`
2. `$pairingToken.state === 'paired'`
3. `$helperOptOut === false`
4. `$lastSession !== null`

`stale` pairing-token state is **not active** — the helper has rejected our token; pushing would just 401 repeatedly. The pusher resumes when the user re-pairs and the state returns to `paired`.

### 4.1 Transitions

| Trigger | Effect |
|---|---|
| Active → Dormant (any condition flips false) | Drain debouncer, `clearInterval` heartbeat. No DELETE — the helper drops the snapshot via TTL (session) or keeps it (persist). |
| Dormant → Active (all conditions become true) | Fire an immediate "fresh-state" push. Covers page-reload-with-existing-session and post-pairing UX. |
| Sign-out | `lastSession` becomes `null` → conditions break → dormant. No `DELETE /status`. Helper's TTL or persist-cache handles it. |
| Persistence-mode flip persist → session | Start heartbeat interval. |
| Persistence-mode flip session → persist | Clear heartbeat interval (no TTL to keep alive). |

## 5. Triggers and payload construction

Every active-state store subscription invokes the same handler:

```ts
function onStoreChange() {
  if (!isActive()) return;
  scheduleDebouncedPush();
}
```

### 5.1 Debounce semantics

Throttle-with-trailing: a "fire immediately if no push in the last 500 ms" rising edge, plus a single trailing push if any events arrived during the cooldown window. Max ~2 pushes/sec.

```
Events:     ●  ●●● ●●  ●         ●●     ●
Pushes:     ▲                ▲   ▲             ▲
            t=0              t=500ms          t=...
            (immediate)      (trailing)       (next immediate)
```

The first event in a quiet period fires the immediate push. Subsequent events within 500 ms are coalesced into one trailing push that captures the latest state.

### 5.2 Payload field mapping

| Payload field | Source store / derivation |
|---|---|
| `schema_version` | Literal `1`. Bump when contract bumps. |
| `updated_at` | `new Date().toISOString()` at push time. |
| `current_state` | `libraryRefreshState.status === 'running' && fetchProgress.status !== 'done'` → `"refreshing"`; running after fetch done → `"hydrating"`; `libraryRefreshState.status === 'error'` → `"error"`; otherwise → `"idle"`. |
| `priority` | Set to `"final"` on the beforeunload path. Omitted otherwise. |
| `library.handle` | `lastSession.handle` |
| `library.did` | `lastSession.did` |
| `library.total_saves` | `inventoryState.inventory.saves.length` when status === 'ready'; null otherwise. |
| `library.by_status` | Aggregated from `inventoryState.inventory.saves[]` retain-mode tags. |
| `hydration.articles` | `{ completed: articleHydration.fetched + articleHydration.skipped, total: articleHydration.total }` |
| `hydration.threads` | `{ completed: threadProgress.fetched + threadProgress.skipped, total: threadProgress.total }` |
| `hydration.images` | `{ completed: imageHydration.fetched + imageHydration.skipped, total: imageHydration.total }` |
| `storage.mode` | `$persistenceMode` → `"session"` or `"persist"` |
| `storage.session_ttl_seconds` | `60` when mode === `"session"`; `null` otherwise. Locked by R7. |
| `storage.browser_bytes_estimate` | Cached result of `navigator.storage.estimate()`; refreshed at most once per minute (not per push). |
| `last_activity.kind` | Derived from libraryRefreshState transitions + hydration store activity. |
| `last_activity.started_at` / `finished_at` | Tracked by status-pusher's internal "current activity" record updated on libraryRefreshState transitions. |
| `last_activity.added` / `removed` | From the most recent `libraryRefreshState`'s reconcile diff. |
| `last_activity.errors` | Array of `{kind, message, count}` from libraryRefreshState's error path and hydrator failure stores. Empty when no errors in the current activity. |

The payload OMITS sections it can't cheaply compute (per contract §4.4). The panel renders what's present.

## 6. Heartbeat (session mode)

```ts
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function refreshHeartbeat() {
  const shouldRun = isActive() && get(persistenceMode) === 'session';
  if (shouldRun && heartbeatTimer === null) {
    heartbeatTimer = setInterval(() => {
      void pushSnapshot({ source: 'heartbeat' });
    }, 15_000);
  } else if (!shouldRun && heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
```

`refreshHeartbeat()` is called whenever an activation condition or `persistenceMode` changes. The heartbeat bypasses the debouncer (it IS the timer) and sends the full payload — it doubles as a "current state" push at a guaranteed cadence.

15 s / 60 s TTL is locked by R7. Hardcoded in `status-pusher.ts` for now (the TTL value is carried in the payload, so future tuning is a payload-only change).

## 7. Beforeunload (persist mode)

```ts
window.addEventListener('beforeunload', () => {
  if (!isActive() || get(persistenceMode) !== 'persist') return;
  const payload = buildStatusPayload({ ...currentInputs(), priority: 'final' });
  if (payload === null) return;
  void fetch(`${config.helperOrigin}/status`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${get(pairingToken).token}`,
    },
    keepalive: true,
  });
});
```

`fetch` with `keepalive: true` is preferred over `navigator.sendBeacon()` because sendBeacon doesn't support custom headers and the helper requires the bearer auth header.

Session mode does not register a beforeunload action — session never writes to disk, so `priority: "final"` has no effect there.

## 8. Failure handling

- **Network error / 4xx / 5xx (non-401):** non-fatal. Log once per failure burst at `console.debug` level: `[status-push] failed: <reason>`. Continue. The next legitimate trigger sends a fresh payload.
- **401 with `WWW-Authenticate: Bearer`:** delegate to `helper-client.ts`'s existing `handleAuthed401` (which calls `markPairingStale`). The activation gate then deactivates the pusher (state !== 'paired'), naturally stopping further pushes until the user re-pairs.
- **401 without `WWW-Authenticate: Bearer`:** same handling as `/fetch` and other authed endpoints (upstream-cause 401, not pairing-cause). The pusher logs and continues; the wider GUI flow handles the upstream auth issue.

No retry inside the pusher. Status freshness on the panel matters more than completeness of any single push.

## 9. "Clear all data" path

`Settings.svelte`'s existing handler runs a sequence: stop hydrators, clear IDB, clear sessionStorage, clear pairing token, clear assetToggles, etc. Insert one step **before** `clearPairingToken()`:

```ts
import { deleteStatus } from '$lib/status-pusher';
// ...
await deleteStatus().catch(() => { /* helper-side cleanup is best-effort */ });
clearPairingToken();
```

`deleteStatus()` sends `DELETE /status` with the current bearer token. On any failure (network, 4xx, 5xx) the function resolves silently — local state is the source of truth, and the user's intent ("wipe everything") proceeds regardless.

```ts
export async function deleteStatus(): Promise<void> {
  const { state, token } = get(pairingToken);
  if (!token || state === 'unpaired') return;
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

## 10. Bootstrap

One line in `app/src/main.ts`, alongside the other init calls:

```ts
import { initStatusPusher } from './lib/status-pusher';
// ...existing init calls (initPairingToken, initCapabilitySnapshot, etc.)...
initStatusPusher();
```

`initStatusPusher()` is synchronous: it wires the subscriptions and the `beforeunload` listener, then returns. The activation gate decides whether any push actually fires.

## 11. Testing strategy

### 11.1 `status-payload.test.ts` (~200 lines)

Unit tests for the pure `buildStatusPayload()` function. Synthesize canonical input states and assert the output payload matches the §4.4 shape exactly.

Cases:
- Active idle (signed in, no refresh running) → `current_state: "idle"`
- Mid-fetch (running, fetchProgress in flight) → `current_state: "refreshing"`
- Mid-hydration (running, fetchProgress done, image hydration running) → `current_state: "hydrating"`
- Error state → `current_state: "error"`, `last_activity.errors` populated
- Session mode → `storage.mode: "session"`, `session_ttl_seconds: 60`
- Persist mode → `storage.mode: "persist"`, `session_ttl_seconds: null`
- Persist mode + `priority: "final"` → adds `priority` field
- Unsigned (lastSession === null) → returns `null`

### 11.2 `status-pusher.test.ts` (~250 lines)

Integration tests with mocked stores and `vi.stubGlobal('fetch', ...)`. Uses `vi.useFakeTimers()` for debounce + heartbeat assertions.

Cases:
- All activation conditions met → first store change fires immediate push
- Any condition flips false → no further pushes
- Rapid store changes → debouncer coalesces to ≤ 2 pushes per simulated second; trailing push captures the latest state
- Session mode + active → 15 s interval fires heartbeat push
- Mode flip persist → session → interval starts; session → persist → interval stops
- `beforeunload` in persist mode → `fetch` called once with `keepalive: true` and `priority: "final"` in body
- `beforeunload` in session mode → no fetch called
- POST returns 401 with `WWW-Authenticate: Bearer` → `markPairingStale` invoked; subsequent pushes drop
- `deleteStatus()` while paired → DELETE issued with bearer
- `deleteStatus()` while unpaired → no-op (no fetch called)
- `deleteStatus()` network failure → resolves silently (doesn't throw)

### 11.3 What's not unit-tested

- Live `POST /status` against a real helper — covered by future helper-side `bsky-saves` tests, and by the maintainer's manual smoke after deploy.
- Panel rendering correctness — installer-team repo's responsibility.
- The `helper-client.ts` 401 path itself (already covered by `helper-client.test.ts`).

## 12. File layout

```
app/src/lib/
├── status-payload.ts          (new, ~150 lines, pure)
├── status-payload.test.ts     (new, ~200 lines)
├── status-pusher.ts           (new, ~250 lines, side-effecting)
└── status-pusher.test.ts      (new, ~250 lines)
```

Touched existing files:
- `app/src/main.ts` — add `initStatusPusher()` call (1 line + 1 import)
- `app/src/routes/Settings.svelte` — add `await deleteStatus()` in the Clear-Data handler (1 line + 1 import)

No store API changes. No changes to existing hydrators. No CSS / svelte component changes.

## 13. Open questions

None. The contract is locked (coord repo `installer-status-panel.md` §7 is empty as of 2026-05-21). All design choices in this spec are either dictated by the contract or are GUI-internal implementation details with no cross-repo impact.

## 14. Implementation order

Suggested when the plan doc gets written:

1. Stand up `status-payload.ts` + tests. Pure function — fastest to validate.
2. Stand up `status-pusher.ts` skeleton (subscription mounting, activation gate, payload-driven push) + tests for activation logic.
3. Add debouncer + heartbeat + tests.
4. Add `beforeunload` listener + test.
5. Add `deleteStatus()` + wire to Settings.svelte. Test that the order is correct (DELETE before pairing-token clear).
6. Add `initStatusPusher()` call to `main.ts`. End-to-end smoke against a local helper.
