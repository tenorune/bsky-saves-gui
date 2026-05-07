import { get } from 'svelte/store';
import { createSession as defaultCreateSession, type AtSession } from './atproto';
import { saveInventory } from './inventory-store';
import { saveAccount } from './account-store';
import { setLastSession } from './last-session';
import { orchestrateRefresh } from './orchestrate-refresh';
import { capabilitySnapshot } from './capability-snapshot';
import { config } from './config';

export interface RunJobOptionsCommon {
  readonly pds: string;
  readonly fetch: boolean;
  readonly threads: boolean;
}

export type RunJobInput =
  | (RunJobOptionsCommon & { readonly mode: 'password'; readonly handle: string; readonly appPassword: string; })
  | (RunJobOptionsCommon & { readonly mode: 'session'; readonly session: AtSession; });

export interface RunJobDeps {
  readonly createSession?: typeof defaultCreateSession;
  readonly orchestrate?: typeof orchestrateRefresh;
  readonly onLog?: (msg: string) => void;
}

export interface RunJobResult {
  readonly session: AtSession;
  readonly inventory: unknown;
}

export async function runJob(input: RunJobInput, deps: RunJobDeps = {}): Promise<RunJobResult> {
  const createSession = deps.createSession ?? defaultCreateSession;
  const orchestrate = deps.orchestrate ?? orchestrateRefresh;
  const log = deps.onLog ?? (() => {});

  if (!input.fetch && !input.threads) {
    throw new Error('Pick at least one step to run.');
  }

  let session: AtSession;
  if (input.mode === 'password') {
    log('Signing in…');
    session = await createSession({ pds: input.pds, identifier: input.handle, password: input.appPassword });
    log(`Signed in as @${session.handle}.`);
  } else {
    session = input.session;
    log(`Reusing session for @${session.handle}.`);
  }

  setLastSession({
    pds: input.pds,
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
    did: session.did,
    handle: session.handle,
  });

  const credentials =
    input.mode === 'password'
      ? { handle: input.handle, appPassword: input.appPassword, pds: input.pds }
      : { accessJwt: session.accessJwt, refreshJwt: session.refreshJwt, did: session.did, pds: input.pds };

  log('Fetching saves…');
  const inventory = await orchestrate({
    credentials,
    includeThreads: input.threads,
    snapshot: get(capabilitySnapshot),
    origin: config.helperOrigin,
  });

  await saveInventory(inventory);
  await saveAccount(session.handle);
  log('Inventory saved.');
  return { session, inventory };
}
