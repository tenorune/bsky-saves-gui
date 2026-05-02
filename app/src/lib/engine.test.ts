// app/src/lib/engine.test.ts
import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

describe('runJob', () => {
  it('signs in, runs Pyodide fetch, persists inventory, returns it', async () => {
    const session = { accessJwt: 'a', refreshJwt: 'r', handle: 'h', did: 'd' };
    const inventory = { saves: [{ uri: 'x' }] };

    const createSession = vi.fn().mockResolvedValue(session);
    const initialise = vi.fn().mockResolvedValue(undefined);
    const runFetch = vi.fn().mockResolvedValue(inventory);
    const onLog = vi.fn();

    const fakeRunner = {
      initialise,
      runFetch,
      onLog: () => () => {},
    };

    const { runJob } = await import('./engine');
    const { loadInventory } = await import('./inventory-store');

    const result = await runJob(
      {
        handle: 'alice.bsky.social',
        appPassword: 'pw',
        pds: 'https://bsky.social',
        enrich: true,
        threads: false,
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
      handle: 'alice.bsky.social',
      appPassword: 'pw',
      pds: 'https://bsky.social',
      enrich: true,
      threads: false,
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

  it('does not initialise Pyodide if sign-in fails', async () => {
    const { InvalidCredentialsError } = await import('./atproto');
    const createSession = vi.fn().mockRejectedValue(new InvalidCredentialsError());
    const initialise = vi.fn();
    const runFetch = vi.fn();

    const { runJob } = await import('./engine');
    await expect(
      runJob(
        { handle: 'a', appPassword: 'b', pds: 'https://x', enrich: false, threads: false },
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
