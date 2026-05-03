import { createSession as defaultCreateSession, type AtSession } from './atproto';
import { PyodideRunner, type FetchOutcome } from './pyodide-runner';
import { loadInventory, saveInventory } from './inventory-store';
import { saveAccount } from './account-store';
import { setLastSession } from './last-session';
import { saveImageBlob } from './image-store';

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
  readonly images: boolean;
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
  runFetch(input: RunnerFetchInput): Promise<FetchOutcome>;
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

  let session: AtSession;
  let appPassword: string;

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
    appPassword = '';
    log(`Reusing session for @${session.handle}.`);
  }

  setLastSession({
    pds: input.pds,
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
    did: session.did,
    handle: session.handle,
  });

  const off = runner.onLog(log);
  let inventory: unknown;
  let imageBlobs: ReadonlyArray<{ url: string; bytes: Uint8Array }> = [];
  try {
    await runner.initialise();
    const outcome = await runner.runFetch({
      handle: session.handle,
      appPassword,
      pds: input.pds,
      fetch: input.fetch,
      enrich: input.enrich,
      threads: input.threads,
      images: input.images,
      existingInventory,
      preauthSession: {
        accessJwt: session.accessJwt,
        refreshJwt: session.refreshJwt,
        did: session.did,
        handle: session.handle,
      },
    });
    inventory = outcome.inventory;
    imageBlobs = outcome.imageBlobs;
  } finally {
    off();
  }

  // Persist any image bytes the worker handed back. Empty when input.images
  // is false or when the hydration step was unable to fetch any (e.g. CORS).
  for (const { url, bytes } of imageBlobs) {
    // Slice into a fresh ArrayBuffer to satisfy Blob's BlobPart type, which
    // doesn't accept Uint8Array<SharedArrayBuffer>.
    const buf = bytes.slice().buffer;
    await saveImageBlob(url, new Blob([buf], { type: 'image/jpeg' }));
  }

  await saveInventory(inventory);
  await saveAccount(session.handle);
  log('Inventory saved.');
  return { session, inventory };
}
