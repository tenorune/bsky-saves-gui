import { enrichProgress, resetEnrichProgress } from './hydration-state';
import { enrichUris as defaultEnrichUris, type EnrichResponse } from './helper-client';
import { getSharedDriver } from './pyodide-worker-driver';
import type { PyodideWorkerDriver } from './pyodide-worker-driver';
import { config } from './config';

export type EnrichBackend = { kind: 'helper' } | { kind: 'pyodide' };

export interface EnrichHydratorInput {
  readonly backend: EnrichBackend;
  readonly origin: string;
  readonly inventory: { readonly saves: readonly { readonly uri: string }[] };
}

export interface EnrichHydratorDeps {
  readonly enrichUris?: (origin: string, req: { uris: readonly string[] }) => Promise<EnrichResponse>;
  readonly driver?: PyodideWorkerDriver;
}

export const enrichHydrator = {
  async start(input: EnrichHydratorInput, deps: EnrichHydratorDeps = {}): Promise<unknown> {
    resetEnrichProgress();
    enrichProgress.set({ status: 'running', total: input.inventory.saves.length, fetched: 0, skipped: 0, failed: 0, failures: [] });
    try {
      if (input.backend.kind === 'helper') {
        const enrich = deps.enrichUris ?? defaultEnrichUris;
        const uris = input.inventory.saves.map((s) => s.uri);
        const res = await enrich(input.origin, { uris });
        const byUri = new Map(res.enriched.map((e) => [e.uri, e.post_created_at]));
        const merged = input.inventory.saves.map((s) => {
          const t = byUri.get(s.uri);
          return t ? { ...s, post_created_at: t } : s;
        });
        enrichProgress.update((p) => ({ ...p, status: 'done', fetched: res.enriched.length, failed: res.errors.length, failures: res.errors.map((e) => ({ url: e.uri, reason: e.reason })) }));
        return { ...input.inventory, saves: merged };
      }
      const driver = deps.driver ?? getSharedDriver();
      await driver.initialise(config.pyodideVersion);
      const out = await driver.runEnrichOnly({ inventory: input.inventory });
      enrichProgress.update((p) => ({ ...p, status: 'done' }));
      return out;
    } catch (e) {
      enrichProgress.update((p) => ({ ...p, status: 'cancelled' }));
      throw e;
    }
  },
};
