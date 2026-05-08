# `bsky-saves` — incremental persistence in `hydrate_threads`

> Proposed change to `bsky_saves.threads.hydrate_threads`. Authored by the `bsky-saves-gui` team to unblock cancel-with-partial-progress on the GUI's Pyodide path. Strict durability improvement; no behavior change for completed runs.

## Goal

Make `hydrate_threads` crash- and cancel-resilient by durably persisting per-iteration progress to the inventory file as it runs, rather than only at the end of the loop.

## Background

`hydrate_threads` (in `bsky_saves/threads.py`) iterates pending saves, fetches each thread via the public AppView, mutates `inv` in memory, and **writes the inventory once after the loop completes**. If the process is killed mid-run — Ctrl-C in the CLI, or `Worker.terminate()` from the GUI's cancel button — every successful fetch in the current run is lost.

The GUI currently terminates its Pyodide worker on cancel (`thread-hydrator.ts:54-61` calls `cancelSharedDriver()`). With incremental writes in `bsky-saves`, the GUI can ask the worker for a final inventory snapshot from disk before terminating and merge the partial progress into its store. The CLI gains the same benefit for free: re-running after a Ctrl-C resumes from where it left off, since the loop already skips saves whose `thread_schema_version` matches the current value.

## Functional requirements

1. **Per-iteration flush.** After each save in the `for i, s in enumerate(pending, 1)` loop has been processed (success or failure path, including the optional `quoted_post` walk), persist the current state of `inv` to `inventory_path` before moving to the next iteration.
2. **Atomic write.** Dump JSON to a sibling temp file (e.g. `inventory_path.with_suffix(inventory_path.suffix + '.tmp')`), then `os.replace()` onto `inventory_path`. A process killed mid-write must never leave a corrupted JSON file. Use the same JSON format as the existing final write (`indent=2, sort_keys=True, ensure_ascii=False` + trailing newline).
3. **Public signature unchanged.** `hydrate_threads(inventory_path, *, appview=, user_agent=) -> tuple[int, int]`. Return value semantics unchanged.
4. **Resumability is already correct.** No new logic required — the existing skip conditions (`thread_schema_version` match or `thread_fetch_error` set) already make a re-run skip everything the previous run completed.

## Non-functional requirements

- **No new dependencies.** `os.replace`, `json.dumps`, `Path.write_text` are stdlib.
- **Disk overhead is negligible.** The loop is already bounded by `RATE_LIMIT_SEC = 0.5` per iteration; a JSON dump of a typical inventory is single-digit milliseconds. The write cost is dwarfed by the rate limit and the network call.
- **`fetched_at` semantics preserved.** Continue to update `inv["fetched_at"]` only on the final post-loop write. Don't churn it per-iteration.

## Out of scope

- A `progress` callback API. Useful but separate; durability is the load-bearing requirement for the GUI's cancel-snapshot use case. Could be added additively in a follow-up without affecting this change.
- Changes to `fetch` or `enrich` loops. They're shorter and not the cancel pain point; they can be addressed separately if motivated.
- Any change to the inventory schema or to the per-save fields written by hydration.

## Negotiation points

The GUI team flags these as items where the maintainer may reasonably push back, with our preferred resolutions:

| Concern | Our position / acceptable compromise |
|---|---|
| "Writing every iteration is excessive." | The 0.5s rate-limit ceiling makes the write cost trivial in absolute terms. **Acceptable compromise:** flush every N iterations (N=5 or 10). The GUI's cancel snapshot will then lag by ≤N saves, which is fine. |
| "I'd rather expose a progress callback than write to disk." | A callback alone doesn't solve crash safety: the process being killed loses the callback's state along with everything else. **Acceptable compromise:** ship both — incremental writes for durability, plus an optional `on_progress` callback for in-process consumers. |
| "Atomic rename in Pyodide MEMFS?" | MEMFS supports `rename` / `os.replace`. Verified in Pyodide. |
| "What about `fetched_at`?" | Keep updating it only on the final write. We agree it shouldn't churn. |

## Suggested implementation sketch

Replace the trailing single-write block in `hydrate_threads` with a small helper called inside the loop:

```python
def _atomic_write_inventory(inventory_path: Path, inv: dict) -> None:
    tmp = inventory_path.with_suffix(inventory_path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(inv, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp, inventory_path)
```

Call `_atomic_write_inventory(inventory_path, inv)` at the bottom of each iteration of the `for i, s in enumerate(pending, 1)` loop. The existing post-loop write becomes the final flush that also stamps `fetched_at`.

## Downstream GUI changes (informational)

After a `bsky-saves` release containing this change, the GUI will:

1. Bump the `bsky-saves==…` pin in `app/src/worker/pyodide-worker.ts`.
2. Add a `snapshot-request` / `snapshot` message round-trip in the Pyodide worker that reads the inventory from `pyodide.FS` and posts it back. (The worker's JS event loop processes the request when Python yields during `httpx.get` or `time.sleep` — typically within ~0.5s.)
3. Replace `cancelSharedDriver()` in `cancelThreadHydration` with a "snapshot-then-terminate" flow that surfaces the partial inventory to the caller.
4. Extend `thread-hydrator.test.ts` with a fake driver that returns a partial snapshot on cancel and asserts the merged inventory carries the partial hydrations forward.

No GUI-side change can deliver this UX without the upstream `bsky-saves` change, because the in-memory `inv` is unreachable from the GUI when the worker is terminated. The cleanest layer for the fix is `bsky-saves` itself, where it also benefits CLI users.
