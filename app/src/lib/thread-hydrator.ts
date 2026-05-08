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
import { getSharedDriver } from './pyodide-worker-driver';
import type { PyodideWorkerDriver } from './pyodide-worker-driver';
import { config } from './config';
import { saveFailures } from './failure-store';
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

/**
 * Cancel an in-flight thread hydration. The helper path checks this flag
 * between chunk fetches; the Pyodide path can't interrupt the worker mid-run
 * but discards the result on completion. Either way, the threadProgress
 * store transitions to 'cancelled' so the UI flips back.
 */
export function cancelThreadHydration(): void {
  _cancelled = true;
  threadProgress.update((p) => ({ ...p, status: 'cancelled' }));
}

export const threadHydrator = {
  async start(input: ThreadHydratorInput, deps: ThreadHydratorDeps = {}): Promise<unknown> {
    _cancelled = false;
    resetThreadProgress();
    try {
      if (input.backend.kind === 'helper') {
        const ht = deps.hydrateThreads ?? defaultHydrateThreads;
        // Skip saves that already have thread_replies populated (matches
        // bsky-saves CLI's hydrate-threads behavior). Failed and new saves
        // are retried on each Refresh.
        const needsHydration = input.inventory.saves.filter((s) => s.thread_replies === undefined);
        const uris = needsHydration.map((s) => s.uri);
        threadProgress.set({ status: 'running', total: uris.length, fetched: 0, skipped: 0, failed: 0, failures: [] });

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
      threadProgress.set({ status: 'running', total: input.inventory.saves.length, fetched: 0, skipped: 0, failed: 0, failures: [] });
      const driver = deps.driver ?? getSharedDriver();
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
        // bsky-saves' hydrate_threads CLI loop prints `[N/M] at://...` per
        // entry. We capture that to drive the threads progress bar in real
        // time. Also handles `bsky-saves: K hydrated, F failed` summary at
        // end (informational; the merged inventory drives the final state).
        onLog: (line: string) => {
          const m = /^\s*\[(\d+)\/(\d+)\]/.exec(line);
          if (m) {
            const fetched = parseInt(m[1], 10);
            const total = parseInt(m[2], 10);
            if (!Number.isNaN(fetched) && !Number.isNaN(total) && total > 0) {
              threadProgress.update((p) => ({ ...p, fetched, total }));
            }
          }
        },
      });
      if (_cancelled) {
        // Pyodide can't stop mid-run; the worker finished, but discard the
        // result so we don't overwrite the existing inventory with a stale run.
        return input.inventory;
      }
      threadProgress.update((p) => ({ ...p, status: 'done', fetched: p.total }));
      return out;
    } catch (e) {
      if (_cancelled) return input.inventory;
      threadProgress.update((p) => ({ ...p, status: 'cancelled' }));
      throw e;
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
