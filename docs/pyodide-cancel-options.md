# Pyodide thread-hydration cancel: design options

> Background and decision record for how the GUI handles cancellation of thread hydration on the Pyodide path. Captures the tradeoff space we surveyed when fixing the "count returns to baseline on cancel" bug ([PR #3](https://github.com/tenorune/bsky-saves-gui/pull/3)). Read this before re-litigating the cancel UX or before extending it to other long-running Pyodide operations.

## Problem statement

`bsky-saves`'s `hydrate_threads` runs in a Web Worker via Pyodide. When the user clicks Cancel, three things should be true:

1. The worker stops hitting the network.
2. The UI flips out of "running" state promptly.
3. **Partial progress already completed is preserved** — saves whose `thread_replies` were just hydrated should remain hydrated across a subsequent refresh.

Today (2026-05) the GUI's HTTP shim in the Pyodide worker uses synchronous `XMLHttpRequest` (via `urllib`, monkey-patched by `pyodide-http`). This means **the worker's JS event loop is blocked while Python is mid-fetch**, and `time.sleep` between iterations also blocks. That has cascading consequences for cancel:

- The parent thread can't run code in the worker without the worker's event loop being free, which it isn't.
- `Worker.terminate()` is the only externally-driven mechanism that works — but it discards the worker's MEMFS, so we lose the per-iteration inventory file `bsky-saves` ≥0.4.2 has been atomically writing.
- A `postMessage`-based snapshot request only gets processed when Python yields between iterations.

The bug that motivated this exploration: with a 2s snapshot timeout (PR #2), the request reliably timed out before Python yielded, and we returned `input.inventory` instead of the partial snapshot — losing every save the Pyodide loop hydrated.

The shipped fix is **option A** below. The other two options are documented for the next time someone asks "can we make Cancel feel instant?" or "can we run heavier Python in workers?".

## The three options

### A — Bump snapshot timeout to ~35s + "cancelling…" UI state

**What it is.** Keep the `snapshot-request` / `snapshot` message round-trip, raise its timeout to cover `bsky-saves`'s worst-case `TIMEOUT = 30.0` per request plus the rate-limit margin. Add a `'cancelling'` status between `'running'` and `'cancelled'`. The UI shows "Saving partial progress…" until the snapshot lands.

**Status.** Shipped in [PR #3](https://github.com/tenorune/bsky-saves-gui/pull/3).

#### Pros

- **Smallest diff.** ~80 lines net across the worker, driver, hydrator, one component, and one route. No infrastructure, no headers, no CDN concerns.
- **Reversible.** If something goes wrong, revert is one commit.
- **Independent of pyodide internals.** Doesn't depend on undocumented Pyodide event-loop behavior, doesn't depend on which pyodide version is loaded, doesn't depend on COOP/COEP support.
- **Honest UX.** Tells the user the truth: "we're waiting for the current fetch to finish so we can save your progress." Users understand network latency.
- **Composable.** Doesn't preclude doing B later. It's purely additive — when B lands, A's timeout becomes a fallback for environments where SAB isn't available (older browsers, embedded contexts, etc.).
- **Trivially testable.** Vitest fake timers can simulate snapshot-arrives-at-Xs and snapshot-times-out scenarios without any new infra. The existing test seam (`requestSnapshotThenCancel` on the fake driver) already covers it.
- **Telemetry comes free.** One log line ("snapshot received after Xms" / "snapshot timed out") gives a dashboard signal for whether real-world cancels are landing in time. If the median is 200ms, you don't need B.
- **Works for every user, every browser, every embedding context.** No feature detection, no `crossOriginIsolated` branching, no fallback path.
- **Decouples release from infra.** Goes out behind no header changes, no CDN audit, no Cloudflare Pages / cf-worker coordination.

#### Cons

- **Worst-case 30s wait** to cancel. If the AppView is slow or a request is timing out, the user sits and stares. Real users may double-cancel, refresh the page, or assume it's hung.
- **Quietly wasteful network during the cancel wait.** While the user is staring at "saving partial progress…", Python is still mid-`fetch_thread` — the AppView keeps getting the request, the rate-limit sleep still ticks. If the user wanted to cancel because they're worried about API quota or because they want to switch networks, A continues hitting the API for up to 30s after they clicked the button. Not a bug, but it's misleading.
- **Page-unload race.** If the user clicks Cancel and immediately closes the tab or navigates, the snapshot-await is cut short, the worker is killed, partial progress is lost. Same behavior as today, but A makes the window for it larger because the cancel takes longer.
- **Verification gap.** Assumes pyodide-http's urllib shim *does* let the worker's event loop drain pending message tasks between iterations. Pyodide's emscripten runtime allows this in principle; `bsky-saves`'s inter-iteration `time.sleep(0.5)` should be a yield point. If for some reason it isn't, the timeout extension just delays the same failure. Verifiable in <30 min with one console.log experiment in production.
- **The "cancelling" state has reach.** Three states (`running`, `cancelling`, `cancelled`) means: progress component must render the new state; tests for `LibraryStatusPanel`, `Settings`, `Library` need updates; any place that branches on `status === 'running'` needs review for whether `'cancelling'` should also disable them.
- **Doesn't reduce surface area.** Every other long-running Python operation (image extraction in pyodide path, future hydrators) has the same blocking-cancel problem. A is point-fix only; we'll re-litigate it for each new operation.
- **Maintenance ratchet.** If `bsky-saves` bumps its `TIMEOUT` (currently 30s), our snapshot ceiling needs to track. Documentation debt that's easy to miss in upstream-bump PRs.
- **Dependency on Python actually yielding** between iterations. Empirically true today; not contractually guaranteed.

### B — Pyodide interrupt buffer (SharedArrayBuffer-based)

**What it is.** Use Pyodide's `setInterruptBuffer(Int32Array)` API. The buffer is backed by a `SharedArrayBuffer` shared with the worker. On cancel, the parent writes `2` (SIGINT) into the buffer; Pyodide checks the buffer at every Python bytecode boundary and raises `KeyboardInterrupt`. `bsky-saves`'s `try/finally` flushes the inventory before the exception propagates. The worker catches the interrupt, reads the inventory, and posts a regular `result`. Cancel is effectively instant.

Requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`) headers so `crossOriginIsolated === true` and `SharedArrayBuffer` is allocatable.

**Status.** Not implemented. Considered as the long-horizon answer if A's 30s tail is a real complaint.

#### Pros

- **Cancel is effectively instant.** SIGINT is checked at every Python bytecode boundary; `KeyboardInterrupt` raises in microseconds. UI flips immediately.
- **Cancel UX is the obvious "right" outcome.** Instant means no new UI state, no copy ambiguity. The user clicks Cancel, the count freezes, they move on. This is what users expect from a Cancel button.
- **Architecturally correct.** This is exactly what `setInterruptBuffer` was designed for. We stop using `terminate()` as a hammer and use cooperative cancellation, which is how every other long-running Python integration handles this.
- **Future-proofs all Pyodide cancellations.** Once the SAB plumbing exists, every other hydrator that runs Python gets cooperative cancel for free.
- **No timeout to tune or document.** Cancel isn't time-bounded, it's deterministic.
- **Eliminates code, doesn't add it.** With B, you can delete the `snapshot-request` / `snapshot` round-trip, `requestSnapshot`, `requestSnapshotThenCancel`, the timeout constant, the `_pendingSnapshot` state, the `consumePendingSnapshot` helper, and the synthetic snapshot tests. Post-cancel flow becomes: worker catches `KeyboardInterrupt`, reads the (already-flushed) inventory, posts `result` like a normal completion. Net deletion is meaningful.
- **General-purpose.** The interrupt-buffer + cooperative-cancel pattern works for fetch, enrich, articles, anything Python. One investment, multiple beneficiaries.
- **Performance side effect.** `crossOriginIsolated` unlocks high-resolution timers (`performance.now()` precision), `WebAssembly.Memory` with `shared: true`, WebAssembly threads. Future heavy work (image decoding, hashing, search indexing) can be parallelized on workers.
- **Security posture improves.** COEP=`require-corp` is itself a hardening — protects against side-channel attacks (Spectre/Meltdown variants), restricts cross-origin assets to those that explicitly opt in. Some operators *want* this for compliance/threat-model reasons.
- **Mature, well-trodden API.** `pyodide.setInterruptBuffer` is the canonical answer; documented, used by JupyterLite and most pyodide-based apps that need cancel.

#### Cons

- **Requires COOP/COEP headers** at every layer that serves the app:
  - Cloudflare Pages / static host configuration.
  - The cf-worker (`templates/cf-worker/...`) needs to emit the headers too.
  - Local dev (`vite preview`, `vite dev`) needs them or pyodide will silently not get its SAB.
- **CORP cascade.** Once COEP=`require-corp` is on, every cross-origin asset must serve `Cross-Origin-Resource-Policy: cross-origin` or be a credentialled CORS request. Pyodide CDN (`cdn.jsdelivr.net`) does serve `CORP: cross-origin`. But anything else cross-origin the app loads (analytics scripts, fonts, third-party images we proxy) has to be audited.
- **CORP cascade discovery is runtime-only.** A future contributor adding a Google Font, an analytics script, an image proxy not yet using CORP, etc., gets a runtime failure. There's no compile-time check.
- **`COEP=credentialless` middle path complicates the choice.** This less-strict variant lets cross-origin no-cors fetches go without credentials, sidestepping CORP for most third-party assets. Slightly less secure but more compatible. Now you have to pick `require-corp` vs `credentialless`, document the choice, and re-evaluate it when you add a new asset source.
- **Embedding constraints.** Cross-origin iframes get `crossOriginIsolated = true` only if the parent already is. If anyone embeds bsky-saves-gui in an iframe, COOP=`same-origin` breaks the embed unless the parent cooperates. Not a concern today, but it's a one-way door for future embed scenarios.
- **Slightly larger memory footprint per worker.** SAB-backed memory + interrupt buffer. Trivial in absolute terms but real.
- **More code paths.** The driver has to detect `crossOriginIsolated` and gracefully fall back to A's behavior when SAB isn't available (dev without headers, ancient browsers). So you don't actually *delete* A's code if you ship B — you make A the fallback.
- **Test infra.** Vitest/jsdom doesn't expose `crossOriginIsolated` and SAB realistically. You either stub them with hand-written fakes (the SAB-write-2 path becomes "we trust the integration") or you skip B's hot path in unit tests and rely on a manual or e2e check. Real test debt.
- **Code complexity doesn't drop to zero.** B doesn't replace A, it supersedes it *when SAB is available*. You still need the timeout fallback for non-isolated contexts. So you ship B *and* A, with a feature-detect branch. Net code is more than A alone.
- **Rollback friction.** Once production has COOP/COEP and code that depends on `crossOriginIsolated`, removing the headers requires deploying a code change first to feature-detect. Two-phase rollback, not one revert.
- **Hard external dependency on jsDelivr's CORP behavior.** Pyodide loads from `cdn.jsdelivr.net`. If jsDelivr ever stops serving `Cross-Origin-Resource-Policy: cross-origin`, the entire app breaks at load time. Not theoretical — this has happened to other CDNs.
- **Headers compound with the cf-worker proxy.** The cf-worker fetches images and articles for the GUI; its responses must serve `Cross-Origin-Resource-Policy` correctly under COEP=`require-corp`. One-line change in the worker, but discoverable only when something else breaks.
- **Browser quirks.** Safari historically has had bugs with `crossOriginIsolated`. Generally good in 2026 but not perfect. Olds (legacy WebViews on iOS, in-app browsers) may not get SAB even with headers — they get A's fallback.
- **Browser support not universal.** A small fraction of users are on browsers without SAB. They get A's fallback. So B's "instant cancel" benefit isn't universal.

### C — Async-ify the HTTP shim

**What it is.** Replace the worker's synchronous-XHR-via-`urllib` shim with an async `fetch()`-based path. With actual async I/O, the worker's JS event loop runs between requests, and the snapshot-request / progress streaming / cancel signal can all be processed without waiting for Python to yield.

**Status.** Not pursued. The framing was initially attractive ("doesn't need SAB / no headers") but on closer inspection that's wrong — see the correction below.

#### Critical correction

`bsky-saves`'s `hydrate_threads` is **sync** Python. To bridge sync Python → async JS, Pyodide offers `pyodide.ffi.run_sync` — which itself requires `SharedArrayBuffer` (it uses `Atomics.wait` to block the WASM thread while JS does async work). **C without SAB cannot let the JS event loop run during a sync Python HTTP call**, because bridging sync→async at the boundary is what SAB is for. Without SAB, the only way to make async fetches work from inside a sync Python loop is to **rewrite `bsky-saves`'s loop as async**.

So C is really one of:

- **C1: Fork bsky-saves, make `hydrate_threads` async.** Cuts the upstream relationship; we now maintain a fork. Big.
- **C2: Upstream `async def hydrate_threads()` to bsky-saves.** Bigger spec than 0.4.2, requires another release cycle, and bsky-saves' CLI users don't benefit (they want sync). Awkward upstream conversation.
- **C3: Use SAB-backed `pyodide.ffi.run_sync` to bridge.** Now we need COOP/COEP anyway — same infra cost as B, but for less benefit. **Strictly dominated by B.**

#### Pros

- **Real-time progress streaming.** Async fetches let log lines flush smoothly between requests, not in chunks. Nice operational improvement, but it's a perf/polish gain, not a cancel gain.
- **HTTP/2 connection reuse.** `fetch()` over modern HTTP/2 reuses connections; sync XHR doesn't. Hydration could be measurably faster.
- **Decouples cancel from network timeouts.** With async, the `KeyboardInterrupt` (still needed) propagates between awaits, so cancel doesn't have to wait for an in-flight request to complete. But you still need the `KeyboardInterrupt` mechanism — i.e., still need B.
- **Real cause-of-blocking fix.** The reason cancel is hard is that the worker's JS event loop is blocked. C addresses that root cause; A and B work around it.

#### Cons

- **Doesn't solve cancel by itself.** Key correction. C is a perf/streaming improvement that *complements* B; it does not substitute for B.
- **Largest engineering surface of the three.** Either upstream-API negotiation (C2), or maintaining a fork (C1), or SAB anyway (C3).
- **bsky-saves API contract changes.** Async signatures ripple — every caller in the Python world has to know whether to `await` or not. CLI users have to wrap with `asyncio.run`. Friction for upstream maintainers.
- **Touches bsky-saves' API contract.** `fetch_thread` is sync. Async-ifying it from outside is fragile — any future bsky-saves change to call sites (timeouts, retries, headers) breaks our shim.
- **Higher debugging cost.** Async errors in pyodide's emscripten/WASM bridge are notoriously hard to trace. Stack traces fragment across JS/Python/WASM boundaries.
- **Maintenance ratchet on the shim.** Whatever httpx surface bsky-saves uses today (POST with json, GET with params, custom headers) we must implement async equivalents. Future bsky-saves features (streaming responses? auth refresh?) extend the shim. Sync-XHR shim is ~50 lines and stable; an async shim with all the surface area (headers, params, redirects, error normalization, JSON / bytes / text) creeps toward 200+ lines.
- **More moving parts to debug.** Async XHR/fetch behavior in workers, especially with pyodide-http's monkey-patching, is a known source of subtle bugs (request ordering, error mapping, header handling). The current sync shim is debuggable; a custom async one is harder.

## Decision matrix

| | Eng cost | Risk | Cancel UX | Future-proof | Solves cancel? |
|---|---|---|---|---|---|
| A | XS | XS | OK (waits a fetch, up to 30s) | Tactical, point-fix | Yes (with caveats) |
| B | M | M (header coordination) | Excellent (instant) | High — generalizes to all Python ops | Yes |
| C | L+ | M-H (upstream negotiation or fork) | Same as A unless paired with B | Perf/streaming, not cancel | **No, alone** |

## Decision

**Ship A. Re-evaluate B if telemetry warrants. Skip C unless we want async-fetch performance for its own sake, and treat it as orthogonal to cancel.**

Specifically:

- **A is the immediate ship.** Lowest cost, biggest unblock per engineering hour, full reversibility. Shipped in [PR #3](https://github.com/tenorune/bsky-saves-gui/pull/3) with `console.info`/`console.warn` instrumenting the snapshot round-trip latency.
- **B is the right long-horizon answer** if (a) DevTools telemetry shows real users hit the 30s cancel window often, or (b) we have an independent reason to want `crossOriginIsolated` (parallel work, hardening). B is meaningful infra work and warrants its own decision moment.
- **C is not the cancel fix.** Re-evaluate it only if we want async-fetch performance for its own sake, and treat it as orthogonal to cancel.

If the gut says "I want instant cancel and I'm happy paying the COOP/COEP cost", skip A and go to B. The header work is real but bounded — a handful of files across vite, cf-worker, and Cloudflare Pages.

## Signals to revisit B

- DevTools `[pyodide-worker] snapshot request timed out after 35000ms` warnings appear regularly (>5% of cancels).
- Users report cancel feels slow or unresponsive.
- A second long-running Pyodide operation gets added (e.g., article hydration without helper) and we'd benefit from the cooperative-cancel pattern across operations.
- A separate motivation arises for `crossOriginIsolated` (WebAssembly threads, high-resolution timers, hardening posture).

## Signals to revisit C

- Hydration throughput becomes a complaint and connection-reuse is the lever.
- bsky-saves independently ships `async def hydrate_threads()`.
