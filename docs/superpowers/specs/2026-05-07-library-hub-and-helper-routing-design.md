# Library hub + helper-routed fetch / enrich / threads — design

> **Status:** approved 2026-05-07. Implementation pending.
> **Branch target:** `main`.
> **Depends on:** `bsky-saves` v0.4.1 (JWT-pair credentials + `"jwt-credentials"` feature flag).
> **Companion spec:** `docs/bsky-saves-serve-fetch-enrich-threads-requirements.md` (the HTTP contract this design consumes).

---

## 1. Summary

Refactor the GUI's data pipeline so that `bsky-saves serve` is the primary backend for every operation it can do (fetch, enrich, hydrate threads, fetch image bytes, extract articles), with Pyodide and worker-proxies as transparent fallbacks. Replace today's full-page Run / Refresh route flow with a unified Library "hub" UX where every operation runs in the background and surfaces structured per-asset progress in a status panel — matching the existing image-hydration / article-hydration UX.

UX goal: **the user shouldn't be able to tell from page behavior which backend is doing the work.** Backend choice is visible (so the user knows what's running), but never alters the flow or the controls.

## 2. Goals and non-goals

### Goals

- A helper-equipped user opts out of Pyodide entirely. No ~10 MB WASM cold-start on fresh sign-in. No Web Worker pinned during long thread walks.
- Library becomes the single hub for everything post-sign-in. Routes `/run` and `/refresh` are deleted.
- Fetch / enrich / threads adopt the hydrator pattern (background tasks, per-asset progress stores, no full-page takeover) used today by image and article backup.
- Settings becomes the single canonical control surface for "back up threads / images / articles" toggles.
- A user can interrupt a running refresh ("Stop") and resume later.
- A user without the helper sees a gentle, dismissible CTA suggesting installation.

### Non-goals

- No `/run`-style one-shot endpoint on the helper. The three granular endpoints (`/fetch`, `/enrich`, `/hydrate-threads`) are sufficient for v0.4.x.
- No streaming progress over SSE / chunked responses from the helper. Each helper request is a single round-trip.
- No mobile/iOS-specific affordances beyond responsive CSS that already works.
- No bundling or auto-installer for `bsky-saves` from the GUI; the install hint links to documentation.
- No OAuth migration — app passwords + JWT-pair restoration remain the auth mechanisms.
- No incremental fetch (today's pipeline does full re-fetch every time; we keep that).

## 3. User-visible changes

- **Sign-in flow:** SignIn submits credentials → background fetch starts → navigate directly to Library. No Refresh page; no Run page.
- **Library page** gains:
  - A header with title, total post count, an optional dominant-backend label, and a `Refresh` button (toggles to `Stop` during a run).
  - A status panel showing three asset rows (Threads / Images / Articles), each with on/off badge, count, optional progress bar, optional inline failure summary (`(N failed · view)`), optional inline "Set up" link, and per-row backend label only when it differs from the dominant one.
  - Optional banners above the rows for: outdated helper, fetch auth error.
  - Optional bottom-of-status install-helper hint (Pyodide users only, dismissible, then lives in Settings).
- **Settings page** gains:
  - Three explicit on/off toggles: "Back up threads," "Back up images," "Back up articles." Default `on` when a backend is available; `off` otherwise. Toggling a switch from off→on triggers hydration of that asset type over the existing inventory.
  - A re-display affordance for the install-helper hint after the user dismisses it from Library.
- **Routes removed:** `/run`, `/refresh`. Bookmarks to those URLs redirect to Library.

## 4. Architecture overview

```
                       ┌──────────────────────────────────┐
                       │ CapabilitySnapshot store (new)   │
                       │ — computed once at startup       │
                       │ — read by hydrators + UI         │
                       └─────────┬────────────────────────┘
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       │                         │                         │
   ┌───▼────┐  ┌──────┐  ┌──────▼─────┐  ┌──────────┐  ┌──▼──────┐
   │ fetch  │  │enrich│  │  thread    │  │  images  │  │articles │
   │Hydrator│  │Hydra-│  │  Hydrator  │  │ Hydrator │  │Hydrator │
   │ (new)  │  │ tor  │  │   (new)    │  │(existing)│  │(existing│
   │        │  │(new) │  │            │  │          │  │         │
   └─┬──┬───┘  └─┬─┬──┘  └────┬───┬───┘  └────┬─────┘  └───┬─────┘
     │  │        │ │          │   │            │            │
     ▼  ▼        ▼ ▼          ▼   ▼            ▼            ▼
   helper Pyodide helper Pyodide  helper Pyodide  helper user-worker  helper user-worker
                                                  operator-worker
                                  (Pyodide path uses the existing pyodide-worker.ts)
```

Five progress stores (`fetchProgress`, `enrichProgress`, `threadProgress`, `imagesProgress`, `articlesProgress`), all matching the existing `HydrationProgress` shape: `{status, total, fetched, skipped, failed, failures[]}`. Library subscribes to all five and renders accordingly.

## 5. CapabilitySnapshot

A single Svelte store, computed once at app startup after the helper `/ping` probe completes and the user/operator worker configs have loaded. Shape:

```ts
type CapabilitySnapshot = {
  helper: { detected: false } | { detected: true; version: string; features: readonly string[] };
  fetch:    { kind: 'helper' } | { kind: 'pyodide' };
  enrich:   { kind: 'helper' } | { kind: 'pyodide' };
  threads:  { kind: 'helper' } | { kind: 'pyodide' };
  images:   { kind: 'helper' } | { kind: 'user-worker'; url: string } | { kind: 'operator-worker' };
  articles: { kind: 'helper' } | { kind: 'user-worker'; url: string } | { kind: 'none' };
};
```

Routing rules:

- `fetch / enrich / threads` → `helper` if `features.includes('fetch') && features.includes('enrich') && features.includes('hydrate-threads') && features.includes('jwt-credentials')`. Else `pyodide`.
- `images` → `helper` if `features.includes('fetch-image')`. Else `user-worker` if a user worker is configured. Else `operator-worker`.
- `articles` → `helper` if `features.includes('extract-article')`. Else `user-worker` if a user worker is configured. Else `none`.

Note: routing is **purely feature-flag introspection**. Helper version is not parsed on the routing path. `MIN_HELPER_VERSION` (currently `0.4.0`) drives the orthogonal "outdated, please upgrade" UX warning surfaced as a banner on Library.

The snapshot is computed once. It does not refresh on every request. Reload re-probes.

## 6. Hydrators

Five hydrator modules. The existing two (`image-hydrator`, `article-hydrator`) already have helper-routed paths today; this design migrates them to read from `CapabilitySnapshot` instead of doing their own per-call routing via `describe-backend`. Their public API and progress-store contract are unchanged. The three new ones (`fetch-hydrator`, `enrich-hydrator`, `thread-hydrator`) follow the same pattern.

Each hydrator:

- Exports `start(input)`, `stop()`, and a progress-store reference.
- Reads `CapabilitySnapshot` to dispatch to a backend.
- Helper path: calls `helper-client` functions, paginates as needed, updates the progress store on each chunk.
- Pyodide path: enqueues a message to a Pyodide-worker driver and translates returned `progress` events into store updates. The Pyodide worker (`app/src/worker/pyodide-worker.ts`) stays as-is; only its driver changes.
- Persists results to IndexedDB via the existing `inventory-store` and `image-store`.

The fetch hydrator is the only one with a non-trivial pagination loop:

1. Call `helperClient.fetch({credentials, cursor: null, limit: 100})`.
2. Append `saves` to in-progress inventory; update `fetchProgress.fetched += saves.length`.
3. If response includes `rotated_credentials`, call `setLastSession(rotated)` synchronously before issuing the next request.
4. If `cursor` is non-null, repeat with the new cursor. Else fetch is complete.
5. Persist the assembled inventory; mark `fetchProgress.status = 'done'`.

Calls are sequential — never parallel. AT Protocol invalidates the loser's `refresh_jwt` if two refreshes happen concurrently.

## 7. Orchestration (replaces `engine.ts`)

A thin `orchestrate-refresh.ts` module replaces the current `engine.ts`. Its only responsibilities:

1. Pull credentials (from `signInDraft` for fresh sign-in or from `last-session` for restore).
2. Call `fetchHydrator.start()` and await completion.
3. Call `enrichHydrator.start()` and await completion.
4. Conditionally call `threadHydrator.start()` (driven by Settings' `backup-threads` toggle).
5. Image / article hydrators trigger themselves off inventory changes (existing pattern), so the orchestrator does not call them directly.

A "Stop" action sets a cancel flag observed by each hydrator's loop; in-flight requests complete, no new requests are issued, and each hydrator's progress-store moves to `cancelled`.

## 8. Inventory shape (`parseInventory` update)

Today `parseInventory` only accepts the inventory-file shape that `bsky-saves` writes from CLI / Pyodide (camelCase nested `record: {text, createdAt, ...}`). It must also accept the helper `/fetch` response's `saves[]` shape (snake_case top-level fields like `post_text`, `saved_at`, `post_created_at` from `/enrich`). Strategy: extend `parseInventory` to normalize either input into the existing internal `Save` shape (defined in `app/src/reader/inventory-shape.ts`). The internal shape does not change. New tests cover both inputs; existing tests continue to cover the Pyodide-shape input unchanged.

The helper-routed pipeline assembles an inventory client-side by concatenating `/fetch` pages, merging `/enrich` deltas keyed by `uri`, and merging `/hydrate-threads` deltas keyed by `uri`. The resulting object is the value persisted to IndexedDB.

## 9. Auth and credential handling

- **Fresh sign-in (password mode).** SignIn collects handle + app password + (optional) "save credentials with passphrase." Submits → orchestrator runs with `{handle, app_password, pds}` credentials passed to the helper or to the Pyodide worker. No refresh logic is needed — each helper request runs its own `createSession`.
- **Session restore (JWT mode), helper path only.** Page reload picks up the JWT pair from `last-session`. Orchestrator runs with `{access_jwt, refresh_jwt, did, pds}` credentials. The helper handles refresh-on-expiry and returns `rotated_credentials` in the `/fetch` response when refresh happened; the orchestrator writes the new pair via `setLastSession` synchronously before issuing the next request. (JWT-mode credentials are not accepted by Pyodide — but the routing rules in §5 mean a JWT-mode user with a Pyodide-only environment continues to use Pyodide with the existing JWT-pass-through path that Pyodide already supports.)
- **Refresh failure.** Helper returns `401 {"error":"auth refresh failed", "code":"refresh_failed"|"upstream_rejected_after_refresh"}`. Library shows an "auth error" banner with a "Sign in" CTA pointing back to SignIn. Existing inventory remains visible (stale data preserved).

## 10. Error handling and surfacing

- **Hydrator failures (per-asset).** Hydrators write to `progress.failures[]`. Library status row shows `(N failed · view)`; clicking "view" opens a small modal listing failed URIs with reasons. Same pattern as today's image / article failures.
- **Fetch auth failure.** Specifically the helper's `401 auth refresh failed` (JWT-mode) or `401 createSession failed` (password-mode), or Pyodide's analogous bad-credentials response. A red banner above the asset rows. Existing data stays in place. CTA: "Sign in."
- **Outdated helper.** A yellow banner above the asset rows. Asset rows continue to show what the older helper can do; the orchestrator falls back to Pyodide where needed.
- **No-backend-available row.** "Articles · no backend available · Set up" with the existing `CustomProxySetupModal` opening on click.
- **Network errors during pagination.** The hydrator marks `fetchProgress.status = 'error'`, surfaces a small inline retry, and the orchestrator halts. No partial inventory is persisted.

## 11. Library status panel — visual contract

(Final design: variant **C** baseline + active fetch (C1) + concurrent hydration (C2) + failures (C3) + needs-setup (C4/C5) + outdated banner (C6) + busy mixed (C7) + auth-error banner (C8) + install-helper hint (C9). Sidebar variant C11 dropped. Banner-style install CTA C10 dropped.)

The status panel is a `<section>` between the Library header and the saves list. Composition:

1. Optional banners (outdated helper, fetch auth error). Stacked.
2. Three asset rows in fixed order: Threads, Images, Articles.
   - Per row: label, on/off badge (or no badge if no backend available), state text (counts, "queued," "no backend available"), optional progress bar, optional `(N failed · view)` paren block, optional `Set up` action-link, optional per-row backend label.
3. Optional install-helper hint at the bottom (Pyodide users only, dismissible).

The "Refresh" button toggles to "Stop" during active runs.

The dominant-backend label in the header (e.g., "via local helper") shows the most-common backend across the asset rows; per-row backend labels only appear on rows that differ.

## 12. Migration / deletions

Files to delete:

- `app/src/routes/Run.svelte`
- `app/src/routes/Refresh.svelte`
- `app/src/lib/engine.ts` (replaced by `orchestrate-refresh.ts`)
- `app/src/lib/pyodide-runner.ts` (replaced by a thinner `pyodide-worker-driver.ts`)

Files to keep but modify:

- `app/src/worker/pyodide-worker.ts` — small additions to emit progress events; existing functionality preserved.
- `app/src/lib/helper-client.ts` — adds `fetch()`, `enrich()`, `hydrateThreads()` exports with cursor / rotated_credentials handling.
- `app/src/lib/last-session.ts` — already has `setLastSession`; orchestrator calls it on rotated credentials.
- `app/src/lib/min-helper-version.ts` — unchanged; `MIN_HELPER_VERSION` stays at `0.4.0` (or bumps to 0.4.1 once that ships).
- `app/src/reader/inventory-shape.ts` — `parseInventory` accepts both shapes.
- `app/src/routes/Library.svelte` — adopts the status panel and the refresh affordance.
- `app/src/routes/SignIn.svelte` — submits to orchestrator; redirects to Library.
- `app/src/routes/Settings.svelte` — adds three on/off toggles + install-helper-hint reset.
- `app/src/lib/router.ts` — removes `/run` and `/refresh` routes.

Files to add:

- `app/src/lib/capability-snapshot.ts`
- `app/src/lib/fetch-hydrator.ts`
- `app/src/lib/enrich-hydrator.ts`
- `app/src/lib/thread-hydrator.ts`
- `app/src/lib/orchestrate-refresh.ts`
- `app/src/lib/pyodide-worker-driver.ts`
- `app/src/components/LibraryStatusPanel.svelte`
- `app/src/components/InstallHelperHint.svelte`
- `app/src/components/AuthErrorBanner.svelte`
- `app/src/components/OutdatedHelperBanner.svelte`

## 13. Testing

- **CapabilitySnapshot:** unit tests for each routing rule; mock `/ping` responses with various feature combinations.
- **Each hydrator:** unit tests for both helper and Pyodide paths; helper path exercises pagination, rotated credentials, error mapping; Pyodide path exercises worker message translation.
- **`parseInventory`:** new tests for helper `/fetch` response shape; existing tests continue to cover Pyodide inventory-file shape.
- **`helper-client`:** tests for `fetch()` cursor round-trip, rotated_credentials persistence, all error codes (`missing credentials`, `invalid cursor`, `createSession failed`, `auth refresh failed`).
- **Orchestrator:** integration test with mocked hydrators verifying sequencing, stop semantics, and threads-toggle gating.
- **Library status panel:** Svelte component tests for each visual state (idle, active, failures, needs-setup, banners).
- **Settings toggles:** tests verifying that flipping a toggle on triggers the corresponding hydrator over existing inventory; toggle off halts mid-run if applicable.
- **End-to-end:** a Playwright test (or equivalent) that boots the app with a mock helper, signs in, observes the Library status panel through fetch → enrich → threads.

## 14. Dependencies

- `bsky-saves` v0.4.1 must be released before the JWT-pair routing path can ship. The implementation can land behind the version-gate; routing for session-mode runs lights up automatically when v0.4.1 daemons are detected.
- The `"jwt-credentials"` feature flag the bsky-saves team is adding to v0.4.1's `/ping` is required by the routing rules in §5.

## 15. Out of scope (deferred)

- **Incremental fetch.** Today's pipeline is full-replace; we preserve that.
- **Backend manual override** in Settings ("force Pyodide for debugging"). Future feature; not needed for first cut.
- **Multi-account support.** One account at a time, same as today.
- **Background refresh on a timer.** Refresh is user-triggered.
- **Push / SSE progress reporting** from the helper. Single-request, single-response.
- **Auto-install of the bsky-saves helper.** The hint links to documentation; the user installs manually.
- **Outdated-helper auto-upgrade.** We surface a warning; the user upgrades manually.

## 16. Open risks

- **Inventory-shape divergence:** `parseInventory` accepting two input shapes adds maintenance surface; the test matrix is the primary mitigation.
- **Concurrent `/fetch` calls during pagination:** an accidental parallel call would invalidate the loser's refresh token. Pagination is naturally sequential, but a stop-and-restart sequence must serialize via a small in-orchestrator mutex.
- **Pyodide path vs helper path drift:** a future bsky-saves change that affects inventory shape on the helper but not in Pyodide (or vice versa) creates a divergence. Mitigated by `parseInventory` normalizing into a single internal shape.
- **First-fetch on slow connection:** the user lands on Library with no saves and a "First fetch in progress" indicator; if fetch takes minutes, the empty state must remain reassuring. UX cost is small but real.

## 17. Acceptance criteria

- A user with `bsky-saves` v0.4.1 helper installed signs in fresh and reaches Library with their saves visible. No Pyodide WASM was loaded.
- The same user reloads the page; session restore picks up; refresh works without re-prompting for the password.
- A user without the helper signs in and reaches Library with their saves visible (Pyodide fallback). The install-helper hint is visible at the bottom of the status panel.
- A user toggles "Back up threads" off in Settings and refreshes; thread hydration is skipped and the Library row reads `Threads · off`.
- A user toggles "Back up threads" back on; thread hydration runs over existing inventory without re-fetching saves.
- A user clicks "Stop" mid-refresh; in-flight requests complete, no new requests fire, the progress stores move to `cancelled`, and partial data isn't persisted as a final inventory.
- A user with an expired session (refresh token rejected by the helper) sees the auth-error banner with a working "Sign in" CTA; the existing inventory remains visible.
- `/run` and `/refresh` URLs redirect to Library.
