// app/src/lib/engine.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(() => {
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
});

describe('runJob', () => {
  it('password mode: calls createSession, runs Pyodide fetch, persists inventory', async () => {
    const session = { accessJwt: 'a', refreshJwt: 'r', handle: 'h', did: 'd' };
    const inventory = { saves: [{ uri: 'x' }] };

    const createSession = vi.fn().mockResolvedValue(session);
    const initialise = vi.fn().mockResolvedValue(undefined);
    const runFetch = vi.fn().mockResolvedValue({ inventory, imageBlobs: [] });
    const onLog = vi.fn();

    const fakeRunner = { initialise, runFetch, onLog: () => () => {} };

    const { runJob } = await import('./engine');
    const { loadInventory } = await import('./inventory-store');

    const result = await runJob(
      {
        mode: 'password',
        handle: 'alice.bsky.social',
        appPassword: 'pw',
        pds: 'https://bsky.social',
        fetch: true,
        enrich: true,
        threads: false, images: false,
      },
      { createSession, runner: fakeRunner, onLog },
    );

    expect(createSession).toHaveBeenCalledWith({
      pds: 'https://bsky.social',
      identifier: 'alice.bsky.social',
      password: 'pw',
    });
    expect(initialise).toHaveBeenCalled();
    expect(runFetch).toHaveBeenCalledWith({
      handle: 'h',
      appPassword: 'pw',
      pds: 'https://bsky.social',
      fetch: true,
      enrich: true,
      threads: false,
      images: false,
      existingInventory: undefined,
      preauthSession: {
        accessJwt: session.accessJwt,
        refreshJwt: session.refreshJwt,
        did: session.did,
        handle: session.handle,
      },
    });
    expect(result.session).toEqual(session);
    expect(result.inventory).toEqual(inventory);
    expect(await loadInventory()).toEqual(inventory);
  });

  it('session mode: skips createSession and reuses the provided session', async () => {
    const session = { accessJwt: 'a', refreshJwt: 'r', handle: 'h', did: 'd' };
    const inventory = { saves: [] };

    const createSession = vi.fn();
    const initialise = vi.fn().mockResolvedValue(undefined);
    const runFetch = vi.fn().mockResolvedValue({ inventory, imageBlobs: [] });

    const { runJob } = await import('./engine');
    const result = await runJob(
      {
        mode: 'session',
        session,
        pds: 'https://bsky.social',
        fetch: true,
        enrich: false,
        threads: true, images: false,
      },
      { createSession, runner: { initialise, runFetch, onLog: () => () => {} } },
    );

    expect(createSession).not.toHaveBeenCalled();
    expect(runFetch).toHaveBeenCalledWith({
      handle: 'h',
      appPassword: '',
      pds: 'https://bsky.social',
      fetch: true,
      enrich: false,
      threads: true,
      images: false,
      existingInventory: undefined,
      preauthSession: {
        accessJwt: session.accessJwt,
        refreshJwt: session.refreshJwt,
        did: session.did,
        handle: session.handle,
      },
    });
    expect(result.session).toEqual(session);
    expect(result.inventory).toEqual(inventory);
  });

  it('does not initialise Pyodide if sign-in fails', async () => {
    const { InvalidCredentialsError } = await import('./atproto');
    const createSession = vi.fn().mockRejectedValue(new InvalidCredentialsError());
    const initialise = vi.fn();
    const runFetch = vi.fn();

    const { runJob } = await import('./engine');
    await expect(
      runJob(
        {
          mode: 'password',
          handle: 'a',
          appPassword: 'b',
          pds: 'https://x',
          fetch: true,
          enrich: false,
          threads: false, images: false,
        },
        {
          createSession,
          runner: { initialise, runFetch, onLog: () => () => {} },
          onLog: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(initialise).not.toHaveBeenCalled();
  });
});
