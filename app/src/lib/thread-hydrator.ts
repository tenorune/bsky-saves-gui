import { threadProgress, resetThreadProgress } from './hydration-state';
import { hydrateThreads as defaultHydrateThreads, type FetchSavesCredentials, type HydrateThreadsResponse } from './helper-client';
import { getSharedDriver } from './pyodide-worker-driver';
import type { PyodideWorkerDriver } from './pyodide-worker-driver';
import { config } from './config';
import type { PreauthSession } from './preauth-session';

export type ThreadBackend = { kind: 'helper' } | { kind: 'pyodide' };

export interface ThreadHydratorInput {
  readonly backend: ThreadBackend;
  readonly origin: string;
  readonly inventory: { readonly saves: readonly { readonly uri: string }[] };
  readonly credentials: FetchSavesCredentials;
  readonly preauthSession?: PreauthSession;
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
        const res = await ht(input.origin, { uris, credentials });
        const byUri = new Map(res.threaded.map((e) => [e.uri, e]));
        const merged = input.inventory.saves.map((s) => {
          const t = byUri.get(s.uri);
          return t ? { ...s, thread_replies: t.thread_replies, thread_schema_version: t.thread_schema_version, thread_fetched_at: t.thread_fetched_at } : s;
        });
        threadProgress.update((p) => ({ ...p, status: 'done', fetched: res.threaded.length, failed: res.errors.length, failures: res.errors.map((e) => ({ url: e.uri, reason: e.reason })) }));
        return { ...input.inventory, saves: merged };
      }
      const driver = deps.driver ?? getSharedDriver();
      await driver.initialise(config.pyodideVersion);
      if (!('appPassword' in input.credentials)) throw new Error('Pyodide path requires app-password credentials');
      const out = await driver.runThreadsOnly({
        inventory: input.inventory,
        handle: input.credentials.handle,
        appPassword: input.credentials.appPassword,
        pds: input.credentials.pds,
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
      threadProgress.update((p) => ({ ...p, status: 'done', fetched: p.total }));
      return out;
    } catch (e) {
      threadProgress.update((p) => ({ ...p, status: 'cancelled' }));
      throw e;
    }
  },
};
