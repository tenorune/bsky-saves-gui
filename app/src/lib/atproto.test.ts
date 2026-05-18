// app/src/lib/atproto.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

describe('atproto.createSession', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs identifier + password to com.atproto.server.createSession on the given PDS', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessJwt: 'jwt-a',
          refreshJwt: 'jwt-r',
          handle: 'alice.bsky.social',
          did: 'did:plc:abc',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { createSession } = await import('./atproto');
    const session = await createSession({
      pds: 'https://bsky.social',
      identifier: 'alice.bsky.social',
      password: 'app-pass-1234',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://bsky.social/xrpc/com.atproto.server.createSession',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: JSON.stringify({ identifier: 'alice.bsky.social', password: 'app-pass-1234' }),
      }),
    );
    expect(session).toEqual({
      accessJwt: 'jwt-a',
      refreshJwt: 'jwt-r',
      handle: 'alice.bsky.social',
      did: 'did:plc:abc',
    });
  });

  it('throws InvalidCredentialsError on 401', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'AuthenticationRequired' }), { status: 401 }),
    );

    const { createSession, InvalidCredentialsError } = await import('./atproto');
    await expect(
      createSession({ pds: 'https://bsky.social', identifier: 'a', password: 'b' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('throws PdsError on 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 503 }));

    const { createSession, PdsError } = await import('./atproto');
    await expect(
      createSession({ pds: 'https://bsky.social', identifier: 'a', password: 'b' }),
    ).rejects.toBeInstanceOf(PdsError);
  });

  it('strips trailing slash from pds', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ accessJwt: 'a', refreshJwt: 'r', handle: 'h', did: 'd' }),
        { status: 200 },
      ),
    );
    const { createSession } = await import('./atproto');
    await createSession({ pds: 'https://pds.example/', identifier: 'a', password: 'b' });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe('https://pds.example/xrpc/com.atproto.server.createSession');
  });

  describe('network / timeout failures', () => {
    it('throws NetworkError when fetch rejects with a TypeError (DNS / TCP / TLS failure)', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { createSession, NetworkError } = await import('./atproto');
      await expect(
        createSession({ pds: 'https://bsky.social', identifier: 'a', password: 'b' }),
      ).rejects.toBeInstanceOf(NetworkError);
    });

    it('throws NetworkError when the abort signal fires (timeout)', async () => {
      fetchSpy.mockImplementationOnce((_url, init: RequestInit) => {
        // Mirror the real fetch contract: reject with a DOMException when
        // the caller's signal aborts. The signal in init.signal is what
        // createSession composes from its timeout AbortController.
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });
      const { createSession, NetworkError } = await import('./atproto');
      await expect(
        createSession({
          pds: 'https://bsky.social',
          identifier: 'a',
          password: 'b',
          timeoutMs: 10,
        }),
      ).rejects.toBeInstanceOf(NetworkError);
    });

    it('passes the abort signal to fetch', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ accessJwt: 'a', refreshJwt: 'r', handle: 'h', did: 'd' }),
          { status: 200 },
        ),
      );
      const { createSession } = await import('./atproto');
      await createSession({
        pds: 'https://bsky.social',
        identifier: 'a',
        password: 'b',
        timeoutMs: 5000,
      });
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('PdsError on 5xx exposes the status code', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('upstream is down', { status: 504 }));
      const { createSession, PdsError } = await import('./atproto');
      try {
        await createSession({ pds: 'https://bsky.social', identifier: 'a', password: 'b' });
        expect.fail('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PdsError);
        expect((e as InstanceType<typeof PdsError>).status).toBe(504);
      }
    });
  });
});
