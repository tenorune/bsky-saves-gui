# `bsky-saves` — caller-driven batching for `hydrate_threads`

> Proposed change to `bsky_saves.threads.hydrate_threads`. Authored by the `bsky-saves-gui` team to make cancel-in-Pyodide responsive without requiring `SharedArrayBuffer` / COOP+COEP infrastructure. Strictly additive; default behavior is unchanged for current callers (CLI included).

## Goal

Let an external caller drive `hydrate_threads` in bounded batches, so control returns to the caller after a fixed amount of work — without changing the function's semantics, return type guarantees, or the existing skip-already-done resumability.

## Background

Since 0.4.2, `hydrate_threads` durably persists per-iteration progress (the change tracked in [`docs/bsky-saves-hydrate-threads-incremental-writes-requirements.md`](./bsky-saves-hydrate-threads-incremental-writes-requirements.md)). That solves crash safety. It does **not** solve cancel responsiveness in environments where the worker's JS event loop is blocked during the call.

Concretely: in the GUI's Pyodide worker, `hydrate_threads` runs synchronously and uses `pyodide-http`'s sync-`XMLHttpRequest` shim under the hood. The worker's JS event loop cannot process incoming messages — including the user's "cancel" signal — until Python returns to it. The shipped UX (PR #3) covers this by waiting up to ~35s for the in-flight fetch to complete, then snapshotting MEMFS. That works, but the worst-case wait is bounded by `bsky-saves`' `TIMEOUT = 30.0` plus rate-limit margin.

If `hydrate_threads` returned to the caller after a small fixed number of saves, the GUI could:

1. Process one batch in Python.
2. Yield to the JS event loop (cancel signals processed here, progress events posted to the main thread).
3. Decide whether to call `hydrate_threads` again, or stop.

This makes cancel feel near-instant (latency = one batch) without requiring `crossOriginIsolated` / `SharedArrayBuffer`. See [`docs/pyodide-cancel-options.md`](./pyodide-cancel-options.md) for the full design space; this proposal sits between option A (shipped) and option B (SAB-based interrupt).

The CLI doesn't need this and isn't impacted: with `limit=None` (the default), behavior is byte-identical to today.

## Functional requirements

1. **New optional keyword argument: `limit: int | None = None`.** When `limit` is `None`, behavior is unchanged from 0.4.2. When `limit` is a non-negative integer `N`, `hydrate_threads` processes at most `N` pending saves in this call and then returns. Items processed include both successful hydrations and items that hit `thread_fetch_error`; both count toward the limit.
2. **Resumability already correct.** The existing skip conditions (matching `thread_schema_version` or non-empty `thread_fetch_error`) already mean the next call resumes where the previous one stopped. No new cursor/state is required.
3. **Per-iteration durable flush preserved.** The 0.4.2 atomic-write behavior is unchanged inside the loop.
4. **End-of-call flush.** At the end of each call (whether the loop exhausted `pending` or hit `limit`), perform the same final atomic write that 0.4.2 already does. The inventory on disk is always in a valid, complete-for-this-call state when the function returns.
5. **`fetched_at` semantics.** Stamp `inv["fetched_at"]` on the final write of any call where `pending` was exhausted (i.e., no more work remaining). Do **not** stamp it on a call that returned because it hit `limit`. This preserves the existing "fetched_at means a complete pass finished" semantic for CLI users.
6. **Return value.** Preferred: extend to `tuple[int, int, int]` = `(succeeded, failed, remaining)`, where `remaining` is the count of pending saves still un-hydrated after this call. Caller stops when `remaining == 0`. Acceptable compromise if the maintainer prefers strict back-compat: keep `tuple[int, int]` and document "caller stops when `succeeded + failed == 0`".
7. **Validation.** `limit` must be `None` or a non-negative `int`; `limit=0` is a valid no-op (returns `(0, 0, len(pending))` or equivalent). Negative or non-int values raise `ValueError` / `TypeError`.

## Non-functional requirements

- **No new dependencies.** Pure-Python control-flow change; no library additions.
- **No schema change.** Inventory format unchanged.
- **No behavior change for `limit=None` callers.** CLI users see no difference. Existing tests that pass no `limit` continue to pass without modification.
- **Negligible per-batch overhead.** The startup work (`_load_inventory`, computing `pending`) is small relative to a single network call. A caller using `limit=1` pays a small constant overhead per item; that's the caller's choice and they can tune the batch size.

## Out of scope

- **An async `hydrate_threads`.** Async-ifying the function (or the underlying `fetch_thread`) is a bigger change with ripple effects on CLI callers; it would also require either an `asyncio.run` wrapper for CLI or a parallel sync entry point. Not needed for the cancel UX motivation here.
- **A progress callback.** Useful in-process, but unnecessary for our use case — the GUI reads the flushed inventory between batches. A callback can be added additively in a follow-up without affecting this change.
- **Concurrency / parallel fetches.** The rate-limit semantics are unchanged; this is purely about returning control to the caller after N items.
- **Changes to `fetch` or `enrich` loops.** They have the same potential issue but aren't the cancel pain point today; address separately if motivated.

## Negotiation points

| Concern | Our position / acceptable compromise |
|---|---|
| "This is API churn for one consumer's UX." | The change is one optional kwarg with a `None` default. Zero impact on existing callers; zero new code paths exercised when `limit=None`. The motivating use case is real (per-cancel UX in the GUI), but the API shape is general enough that any future caller wanting cooperative scheduling benefits the same way. |
| "Why not a progress callback that can return False to break?" | A callback runs *inside* the Python loop; control never leaves Python. The whole point is to return to the JS event loop so it can drain pending messages. A callback alone doesn't achieve that. **Acceptable compromise:** ship both — `limit` for cooperative scheduling, plus an optional `on_progress` callback for in-process consumers. They compose cleanly. |
| "Why not async-ify `hydrate_threads`?" | Bigger spec, ripples through CLI callers, requires `asyncio.run` wrappers, and the upstream maintainer ends up with two API contracts to support. `limit` is the smallest viable change that solves the cancel UX. |
| "Returning a 3-tuple breaks API contract." | Fair. **Acceptable compromise:** keep `(succeeded, failed)` and document the caller stop condition as "both counters zero". The `remaining` count is nice-to-have, not load-bearing. |
| "What about `fetched_at` if the caller stops early?" | Don't stamp it on a partial call. Stamp only when `pending` is exhausted in this call. This preserves the existing CLI invariant: `fetched_at` = "a full pass completed". |
| "Won't a `limit=1` caller create write amplification?" | Negligible. The per-iteration atomic write already happens in 0.4.2; the only extra cost of small batches is repeated `_load_inventory` / pending computation, single-digit ms each. The caller picks `limit` to balance responsiveness vs. overhead. |
| "Does `limit` count failed items?" | Yes — `limit` is "items attempted in this call", not "items succeeded". Otherwise a run of all-failures could loop forever in the caller's batch loop. |

## Suggested implementation sketch

A minimal patch to the existing loop:

```python
def hydrate_threads(
    inventory_path: Path,
    *,
    appview: str = ...,
    user_agent: str = ...,
    limit: int | None = None,
) -> tuple[int, int, int]:  # or tuple[int, int] if maintainer prefers
    if limit is not None and (not isinstance(limit, int) or limit < 0):
        raise ValueError("limit must be a non-negative int or None")

    inv = _load_inventory(inventory_path)
    pending = _select_pending(inv)
    total_pending = len(pending)
    succeeded = 0
    failed = 0
    processed = 0

    for i, s in enumerate(pending, 1):
        if limit is not None and processed >= limit:
            break
        # ... existing per-iteration logic (fetch, enrich, mutate inv,
        #     atomic-flush from 0.4.2) ...
        processed += 1

    remaining = total_pending - processed
    if remaining == 0:
        inv["fetched_at"] = _now_iso()
    _atomic_write_inventory(inventory_path, inv)
    return succeeded, failed, remaining  # or (succeeded, failed)
```

The shape of the loop body and the atomic-flush helper from 0.4.2 are unchanged. Only the loop's exit condition and the `fetched_at` stamp gain a `limit`-aware branch.

## Test guidance (suggested)

- Existing tests with no `limit` argument continue to pass unchanged.
- A new test calls `hydrate_threads(..., limit=1)` repeatedly against a fixture inventory with 3 pending saves; asserts each call processes exactly one item, that `fetched_at` is unset until the last call, and that the final inventory is identical to a single-call run with `limit=None`.
- A test with `limit=0` asserts no-op (no fetches, `fetched_at` unchanged unless `pending` was already empty).
- A test with `limit` greater than `len(pending)` asserts behavior identical to `limit=None`.
- A test with all items failing fetch asserts `limit` still bounds the call (failures count toward `limit`).

## Downstream GUI changes (informational)

After a `bsky-saves` release containing this change, the GUI will:

1. Bump the `bsky-saves==…` pin in `app/src/worker/pyodide-worker.ts`.
2. Replace the worker's single `hydrate_threads(inv_path)` call with a JS-driven loop that calls `hydrate_threads(inv_path, limit=BATCH_SIZE)` repeatedly. Between calls, the worker's JS event loop drains — pending `cancel` messages are processed; progress events are posted to the main thread.
3. On cancel: stop calling the next batch, read the (already-flushed) inventory, post `result` like a normal completion. The `'cancelling'` state introduced in PR #3 stays in place but typical wait collapses from up to 30s to one batch's duration (tunable; ~1–5 saves seems reasonable).
4. Drop the 35s snapshot-timeout fallback once batched mode is the only path. (Or keep it as a defense for older `bsky-saves` versions; cheap to retain.)
5. Add a `thread-hydrator` test that uses a fake worker driver returning per-batch results and asserts cancel between batches preserves the partial inventory.

This is strictly cheaper than the SAB-based approach (option B in the cancel-options doc): no COOP/COEP headers, no `crossOriginIsolated` audit across vite, the cf-worker, and Cloudflare Pages, no CORP cascade for cross-origin assets.

## Why upstream and not in the GUI

The GUI cannot achieve this UX from outside `bsky-saves` without one of:

- **Forking `bsky-saves`** to insert an external break in its loop. Cuts the upstream relationship.
- **Wrapping every save individually** in our own Python (call `fetch_thread` + `enrich_thread` directly, skipping `hydrate_threads`). Reimplements a chunk of `bsky-saves`' public behavior; brittle against future upstream changes (timeout policy, rate-limit handling, schema bumps).
- **`SharedArrayBuffer`-based interrupts.** Solves cancel without an upstream change but requires multi-layer header coordination (vite, cf-worker, Cloudflare Pages) and an audit of every cross-origin asset for CORP compatibility.

Adding a `limit` kwarg upstream is by far the least invasive of these for both projects, and it's the kind of API a future async/streaming `bsky-saves` consumer would also benefit from.
