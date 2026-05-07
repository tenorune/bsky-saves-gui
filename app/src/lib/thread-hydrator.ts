import { threadProgress, resetThreadProgress } from './hydration-state';
import { hydrateThreads as defaultHydrateThreads, type FetchSavesCredentials, type HydrateThreadsResponse } from './helper-client';
import { getSharedDriver } from './pyodide-worker-driver';
import type { PyodideWorkerDriver } from './pyodide-worker-driver';
import { config } from './config';

export type ThreadBackend = { kind: 'helper' } | { kind: 'pyodide' };

export interface ThreadHydratorInput {
  readonly backend: ThreadBackend;
  readonly origin: string;
  readonly inventory: { readonly saves: readonly { readonly uri: string }[] };
  readonly credentials: FetchSavesCredentials;
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
        const res = await ht(input.origin, { uris, credentials: input.credentials });
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
      });
      threadProgress.update((p) => ({ ...p, status: 'done' }));
      return out;
    } catch (e) {
      threadProgress.update((p) => ({ ...p, status: 'cancelled' }));
      throw e;
    }
  },
};
