// app/src/lib/engine.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(() => {
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
});

describe('runJob (orchestrator-shim)', () => {
  it('delegates to orchestrateRefresh and returns session+inventory', async () => {
    const orchestrate = vi.fn().mockResolvedValue({ saves: [{ uri: 'at://x' }] });
    const createSession = vi.fn().mockResolvedValue({ accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1', handle: 'a.bsky.social' });

    const { runJob } = await import('./engine');

    const out = await runJob({
      mode: 'password',
      pds: 'https://bsky.social',
      handle: 'a.bsky.social',
      appPassword: 'pw',
      fetch: true,
      threads: true,
    }, { createSession, orchestrate });

    expect(orchestrate).toHaveBeenCalled();
    expect(out.inventory).toEqual({ saves: [{ uri: 'at://x' }] });
    expect(out.session.handle).toBe('a.bsky.social');
  });

  it('session mode: skips createSession and reuses the provided session', async () => {
    const session = { accessJwt: 'a', refreshJwt: 'r', handle: 'h', did: 'd' };
    const orchestrate = vi.fn().mockResolvedValue({ saves: [] });
    const createSession = vi.fn();

    const { runJob } = await import('./engine');
    const result = await runJob(
      {
        mode: 'session',
        session,
        pds: 'https://bsky.social',
        fetch: true,
        threads: true,
      },
      { createSession, orchestrate },
    );

    expect(createSession).not.toHaveBeenCalled();
    expect(orchestrate).toHaveBeenCalled();
    expect(result.session).toEqual(session);
    expect(result.inventory).toEqual({ saves: [] });
  });

  it('does not call orchestrate if sign-in fails', async () => {
    const { InvalidCredentialsError } = await import('./atproto');
    const createSession = vi.fn().mockRejectedValue(new InvalidCredentialsError());
    const orchestrate = vi.fn();

    const { runJob } = await import('./engine');
    await expect(
      runJob(
        {
          mode: 'password',
          handle: 'a',
          appPassword: 'b',
          pds: 'https://x',
          fetch: true,
          threads: false,
        },
        { createSession, orchestrate, onLog: () => {} },
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(orchestrate).not.toHaveBeenCalled();
  });
});
