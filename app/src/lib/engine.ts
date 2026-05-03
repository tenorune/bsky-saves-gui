import { createSession as defaultCreateSession, type AtSession } from './atproto';
import { PyodideRunner } from './pyodide-runner';
import { loadInventory, saveInventory } from './inventory-store';
import { saveAccount } from './account-store';
import { setLastSession } from './last-session';
import { hydrateImages } from './image-hydrator';

export interface RunJobOptionsCommon {
  readonly pds: string;
  readonly fetch: boolean;
  readonly enrich: boolean;
  readonly threads: boolean;
  readonly images: boolean;
}

export type RunJobInput =
  | (RunJobOptionsCommon & {
      readonly mode: 'password';
      readonly handle: string;
      readonly appPassword: string;
    })
  | (RunJobOptionsCommon & {
      readonly mode: 'session';
      readonly session: AtSession;
    });

interface RunnerFetchInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly fetch: boolean;
  readonly enrich: boolean;
  readonly threads: boolean;
  readonly existingInventory?: unknown;
  readonly preauthSession?: {
    readonly accessJwt: string;
    readonly refreshJwt: string;
    readonly did: string;
    readonly handle: string;
  };
}

interface RunnerLike {
  initialise(): Promise<void>;
  runFetch(input: RunnerFetchInput): Promise<unknown>;
  onLog(listener: (msg: string) => void): () => void;
}

export interface RunJobDeps {
  readonly createSession?: typeof defaultCreateSession;
  readonly runner?: RunnerLike;
  readonly onLog?: (msg: string) => void;
}

export interface RunJobResult {
  readonly session: AtSession;
  readonly inventory: unknown;
}

export async function runJob(input: RunJobInput, deps: RunJobDeps = {}): Promise<RunJobResult> {
  const createSession = deps.createSession ?? defaultCreateSession;
  const runner = deps.runner ?? new PyodideRunner();
  const log = deps.onLog ?? (() => {});

  if (!input.fetch && !input.enrich && !input.threads && !input.images) {
    throw new Error('Pick at least one step to run.');
  }

  let existingInventory: unknown;
  if (!input.fetch) {
    existingInventory = await loadInventory();
    if (!existingInventory) {
      throw new Error(
        'No saved library yet. Turn on "Pull in any newly saved posts" the first time.',
      );
    }
  }

  // Image-only updates skip Pyodide entirely — images come from cdn.bsky.app
  // via plain JS fetch and don't need an AT-Proto session.
  const needsRunner = input.fetch || input.enrich || input.threads;

  let session: AtSession | null = null;
  let appPassword = '';

  if (needsRunner) {
    if (input.mode === 'password') {
      log('Signing in…');
      session = await createSession({
        pds: input.pds,
        identifier: input.handle,
        password: input.appPassword,
      });
      appPassword = input.appPassword;
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
  } else if (input.mode === 'session') {
    session = input.session;
  }

  let inventory: unknown = existingInventory;
  if (needsRunner) {
    const off = runner.onLog(log);
    try {
      await runner.initialise();
      inventory = await runner.runFetch({
        handle: session!.handle,
        appPassword,
        pds: input.pds,
        fetch: input.fetch,
        enrich: input.enrich,
        threads: input.threads,
        existingInventory,
        preauthSession: {
          accessJwt: session!.accessJwt,
          refreshJwt: session!.refreshJwt,
          did: session!.did,
          handle: session!.handle,
        },
      });
    } finally {
      off();
    }
  }

  if (input.images) {
    const { inventory: hydrated } = await hydrateImages(inventory, { onLog: log });
    inventory = hydrated;
  }

  await saveInventory(inventory);
  if (session) await saveAccount(session.handle);
  log('Inventory saved.');
  // Synthesize a minimal session for callers that expect one (e.g., refresh
  // flow). When images-only and no prior session existed, fall through with a
  // stub — Run.svelte ignores it on success.
  return {
    session: session ?? { accessJwt: '', refreshJwt: '', did: '', handle: '' },
    inventory,
  };
}
