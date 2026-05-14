import type { CapabilitySnapshot } from './capability-snapshot';
import type { FetchSavesCredentials } from './helper-client';
import type { PreauthSession } from './preauth-session';
import { fetchHydrator as defaultFetchHydrator } from './fetch-hydrator';
import { enrichHydrator as defaultEnrichHydrator } from './enrich-hydrator';
import { threadHydrator as defaultThreadHydrator } from './thread-hydrator';

export interface OrchestrateRefreshInput {
  readonly credentials: FetchSavesCredentials;
  readonly includeThreads: boolean;
  readonly snapshot: CapabilitySnapshot;
  readonly origin: string;
  readonly preauthSession?: PreauthSession;
}

export interface OrchestrateRefreshDeps {
  readonly fetchHydrator?:  { start: typeof defaultFetchHydrator.start };
  readonly enrichHydrator?: { start: typeof defaultEnrichHydrator.start };
  readonly threadHydrator?: { start: typeof defaultThreadHydrator.start };
  // May return a replacement inventory (the v0.6.0 retain-flag reconcile
  // returns a new, possibly smaller save set); when it does, the rest of the
  // pipeline (threads, final save) continues from the replacement.
  readonly onAfterEnrich?: (inv: unknown) => Promise<unknown> | unknown;
}

export async function orchestrateRefresh(
  input: OrchestrateRefreshInput,
  deps: OrchestrateRefreshDeps = {},
): Promise<unknown> {
  const fetchH  = deps.fetchHydrator  ?? defaultFetchHydrator;
  const enrichH = deps.enrichHydrator ?? defaultEnrichHydrator;
  const threadH = deps.threadHydrator ?? defaultThreadHydrator;

  let inv = await fetchH.start({
    backend: input.snapshot.fetch,
    origin: input.origin,
    credentials: input.credentials,
    preauthSession: input.preauthSession,
  }) as { saves: readonly { uri: string }[] };

  inv = await enrichH.start({
    backend: input.snapshot.enrich,
    origin: input.origin,
    inventory: inv,
  }) as typeof inv;

  if (deps.onAfterEnrich) {
    const replaced = await deps.onAfterEnrich(inv);
    if (replaced && typeof replaced === 'object') {
      inv = replaced as typeof inv;
    }
  }

  if (input.includeThreads) {
    inv = await threadH.start({
      backend: input.snapshot.threads,
      origin: input.origin,
      inventory: inv,
      credentials: input.credentials,
      preauthSession: input.preauthSession,
    }) as typeof inv;
  }

  return inv;
}
