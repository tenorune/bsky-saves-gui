import { createSession as defaultCreateSession, type AtSession } from './atproto';
import { PyodideRunner } from './pyodide-runner';
import { saveInventory } from './inventory-store';
import { saveAccount } from './account-store';
import { setLastSession } from './last-session';

export interface RunJobInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly enrich: boolean;
}

interface RunnerLike {
  initialise(): Promise<void>;
  runFetch(input: RunJobInput & {
    preauthSession?: {
      accessJwt: string;
      refreshJwt: string;
      did: string;
      handle: string;
    };
  }): Promise<unknown>;
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

  log('Signing in…');
  const session = await createSession({
    pds: input.pds,
    identifier: input.handle,
    password: input.appPassword,
  });
  log(`Signed in as @${session.handle}.`);
  setLastSession({ pds: input.pds, accessJwt: session.accessJwt, did: session.did, handle: session.handle });

  const off = runner.onLog(log);
  try {
    await runner.initialise();
    const inventory = await runner.runFetch({
      ...input,
      preauthSession: {
        accessJwt: session.accessJwt,
        refreshJwt: session.refreshJwt,
        did: session.did,
        handle: session.handle,
      },
    });
    await saveInventory(inventory);
    await saveAccount(session.handle);
    log('Inventory saved.');
    return { session, inventory };
  } finally {
    off();
  }
}
