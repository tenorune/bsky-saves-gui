// Thread hydration: walks the inventory's saves and fills thread_replies
// (same-author reply chains) on each one via the helper's /hydrate-threads
// endpoint or via Pyodide.
//
// HYDRATION INVARIANT (applies to every hydrator in this app):
//   - Never re-fetch what we already have.
//   - The displayed count must reflect cumulative coverage from frame
//     zero of every run — pre-compute `skipped` BEFORE setting the store,
//     and seed `failures` from the persisted list.
// Implementation: filter input saves to only those missing thread_replies
// (matching bsky-saves CLI's hydrate-threads behavior). Saves whose
// thread_replies were carried forward by library-refresh.mergeHydratedFields
// are skipped here; only newly-fetched saves go through the hydrator.
//
// thread_replies / thread_schema_version / thread_fetched_at are stored
// directly on each save in the inventory (a fresh /fetch wipes them);
// see library-refresh.mergeHydratedFields for the canonical list of
// local-only annotations carried across each refresh.

import { threadProgress, resetThreadProgress } from './hydration-state';
import { hydrateThreads as defaultHydrateThreads, type FetchSavesCredentials, type HydrateThreadsResponse } from './helper-client';
import { getSharedDriver, requestCancelSharedDriver } from './pyodide-worker-driver';
import type { PyodideWorkerDriver } from './pyodide-worker-driver';
import { config } from './config';
import { saveFailures, loadFailures } from './failure-store';
import type { PreauthSession } from './preauth-session';

export type ThreadBackend = { kind: 'helper' } | { kind: 'pyodide' };

export interface ThreadHydratorInput {
  readonly backend: ThreadBackend;
  readonly origin: string;
  readonly inventory: { readonly saves: readonly { readonly uri: string; readonly thread_replies?: unknown }[] };
  readonly credentials: FetchSavesCredentials;
  readonly preauthSession?: PreauthSession;
}

export interface ThreadHydratorDeps {
  readonly hydrateThreads?: (origin: string, req: { uris: readonly string[]; credentials: FetchSavesCredentials }) => Promise<HydrateThreadsResponse>;
  readonly driver?: PyodideWorkerDriver;
}

let _cancelled = false;
let _activeBackend: 'helper' | 'pyodide' | null = null;
let _activeDriver: PyodideWorkerDriver | null = null;

/**
 * Cancel an in-flight thread hydration. The helper path checks `_cancelled`
 * between chunk fetches and flips straight to 'cancelled'. The Pyodide path
 * uses cooperative cancel (bsky-saves >=0.4.3): we post `cancel-hydration`
 * to the worker and set status to 'cancelling'. The worker's JS-driven
 * batched loop reads the flag between batches, breaks out, reads the
 * (already-flushed) inventory from disk, and resolves the in-flight
 * runThreadsOnly call with that partial inventory as a normal result.
 * Cancel latency is one batch's worth of fetches — typically <3s, worst
 * case bounded by bsky-saves' httpx TIMEOUT per in-flight fetch.
 */
export function cancelThreadHydration(): void {
  _cancelled = true;
  if (_activeBackend === 'pyodide') {
    threadProgress.update((p) => ({ ...p, status: 'cancelling' }));
    if (_activeDriver) {
      _activeDriver.requestCancel();
    } else {
      requestCancelSharedDriver();
    }
  } else {
    threadProgress.update((p) => ({ ...p, status: 'cancelled' }));
  }
}

export const threadHydrator = {
  async start(input: ThreadHydratorInput, deps: ThreadHydratorDeps = {}): Promise<unknown> {
    _cancelled = false;
    _activeBackend = input.backend.kind;
    _activeDriver = null;
    resetThreadProgress();
    try {
      if (input.backend.kind === 'helper') {
        const ht = deps.hydrateThreads ?? defaultHydrateThreads;
        // Skip saves that already have thread_replies populated (matches
        // bsky-saves CLI's hydrate-threads behavior). Failed and new saves
        // are retried on each Refresh.
        const allSaves = input.inventory.saves;
        const needsHydration = allSaves.filter((s) => s.thread_replies === undefined);
        const uris = needsHydration.map((s) => s.uri);
        const skipped = allSaves.length - needsHydration.length;
        // Carry forward persisted failures whose URI is still in scope
        // for hydration so the count doesn't flash to 0 each refresh.
        const persisted = await loadFailures('threads');
        const carried = persisted.filter((f) => uris.includes(f.url));
        threadProgress.set({
          status: 'running',
          total: allSaves.length,
          fetched: 0,
          skipped,
          failed: carried.length,
          failures: [...carried],
        });

        if (uris.length === 0) {
          threadProgress.update((p) => ({ ...p, status: 'done' }));
          return input.inventory;
        }

        // Prefer JWT-pair credentials when available so the helper skips
        // its createSession validation step. See fetch-hydrator for the
        // full rationale (eurosky.social etc. rate-limit createSession).
        const pdsFromCreds = 'pds' in input.credentials && input.credentials.pds
          ? input.credentials.pds
          : undefined;
        const credentials: FetchSavesCredentials = input.preauthSession
          ? {
              accessJwt: input.preauthSession.accessJwt,
              refreshJwt: input.preauthSession.refreshJwt,
              did: input.preauthSession.did,
              ...(pdsFromCreds ? { pds: pdsFromCreds } : {}),
            }
          : input.credentials;

        // Chunk the URIs and call /hydrate-threads per chunk so the progress
        // bar moves in real time. Under JWT path, /hydrate-threads skips
        // createSession entirely and the upstream call is to the public
        // AppView, so chunking is essentially free per request (vs. the
        // app-password path where each chunk would trigger another PDS
        // createSession). Tune this if a daemon's per-request overhead
        // changes; smaller chunks = smoother progress, more requests.
        const CHUNK_SIZE = 25;
        const allThreaded: HydrateThreadsResponse['threaded'][number][] = [];
        const allErrors: HydrateThreadsResponse['errors'][number][] = [];
        for (let i = 0; i < uris.length; i += CHUNK_SIZE) {
          if (_cancelled) {
            // Bail out cleanly: status was already set to 'cancelled' by
            // cancelThreadHydration; just return what we've merged so far.
            return mergeThreaded(input.inventory, allThreaded);
          }
          const chunk = uris.slice(i, i + CHUNK_SIZE);
          const res = await ht(input.origin, { uris: chunk, credentials });
          allThreaded.push(...res.threaded);
          allErrors.push(...res.errors);
          threadProgress.update((p) => ({
            ...p,
            fetched: Math.min(p.total, allThreaded.length + allErrors.length),
            failed: allErrors.length,
            failures: allErrors.map((e) => ({ url: e.uri, reason: e.reason })),
          }));
        }
        const merged = mergeThreaded(input.inventory, allThreaded);
        const failuresOut = allErrors.map((e) => ({ url: e.uri, reason: e.reason }));
        await saveFailures('threads', failuresOut);
        threadProgress.update((p) => ({
          ...p,
          status: 'done',
          fetched: allThreaded.length,
          failed: allErrors.length,
          failures: failuresOut,
        }));
        return merged;
      }
      // Pre-compute skipped (saves already with thread_replies) so the
      // displayed count is cumulative across cancel+restart cycles, and
      // carry forward persisted failures.
      const allSavesPy = input.inventory.saves;
      const skippedPy = allSavesPy.filter((s) => s.thread_replies !== undefined).length;
      const persistedPy = await loadFailures('threads');
      const carriedFailedCount = persistedPy.length;
      threadProgress.set({
        status: 'running',
        total: allSavesPy.length,
        fetched: 0,
        skipped: skippedPy,
        failed: carriedFailedCount,
        failures: [...persistedPy],
      });
      const driver = deps.driver ?? getSharedDriver();
      // Stash the injected driver only — production goes through the
      // shared-driver singleton helper on cancel.
      _activeDriver = deps.driver ?? null;
      await driver.initialise(config.pyodideVersion);
      // With preauthSession in hand the worker's monkey-patch bypasses
      // createSession; appPassword is then unused, so JWT-pair credentials
      // are accepted (handle comes from preauthSession).
      const isAppPw = 'appPassword' in input.credentials;
      if (!isAppPw && !input.preauthSession) {
        throw new Error('Pyodide path requires app-password credentials');
      }
      const pyHandle = isAppPw
        ? input.credentials.handle
        : (input.preauthSession?.handle ?? '');
      const pyAppPassword = isAppPw ? input.credentials.appPassword : '';
      const pyPds = ('pds' in input.credentials && input.credentials.pds) || 'https://bsky.social';
      const out = await driver.runThreadsOnly({
        inventory: input.inventory,
        handle: pyHandle,
        appPassword: pyAppPassword,
        pds: pyPds,
        preauthSession: input.preauthSession,
      }, {
        // The worker emits a progress message after each batch of the
        // JS-driven hydrate_threads loop with cumulative succeeded/failed
        // and remaining-pending counts. Drive the progress store directly
        // from these so display is accurate without parsing stdout.
        onProgress: ({ succeeded, failed }) => {
          threadProgress.update((p) => ({
            ...p,
            fetched: succeeded,
            failed: carriedFailedCount + failed,
          }));
        },
      });
      if (_cancelled) {
        // Worker resolved with the partial inventory it had on disk when
        // the cancel flag was observed between batches. Surface that as the
        // result; the run page persists it and refreshes the library.
        threadProgress.update((p) => ({ ...p, status: 'cancelled' }));
        return out;
      }
      // On clean completion, this run hydrated every save that needed it.
      // fetched = total - skipped - failed (failed stays as carried + new).
      threadProgress.update((p) => ({ ...p, status: 'done', fetched: Math.max(0, p.total - p.skipped - p.failed) }));
      return out;
    } catch (e) {
      threadProgress.update((p) => ({ ...p, status: 'cancelled' }));
      throw e;
    } finally {
      _activeBackend = null;
      _activeDriver = null;
    }
  },
};

function mergeThreaded(
  inv: ThreadHydratorInput['inventory'],
  threaded: HydrateThreadsResponse['threaded'][number][],
): { saves: typeof inv.saves } {
  const byUri = new Map(threaded.map((e) => [e.uri, e]));
  const merged = inv.saves.map((s) => {
    const t = byUri.get(s.uri);
    return t
      ? { ...s, thread_replies: t.thread_replies, thread_schema_version: t.thread_schema_version, thread_fetched_at: t.thread_fetched_at }
      : s;
  });
  return { ...inv, saves: merged };
}
