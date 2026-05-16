import { describe, expect, it, beforeEach, vi } from 'vitest';
import { _resetPairingTokenForTests } from './pairing-token';

beforeEach(() => {
  vi.unstubAllGlobals();
  // Reset pairing-token state so tests start from 'unpaired'; tests that
  // need a paired state call setPairingToken() themselves.
  _resetPairingTokenForTests();
});

describe('helper-client probeHelper', () => {
  it('reports available with version + features when /ping returns the expected JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          name: 'bsky-saves',
          version: '0.2.4',
          features: ['fetch-image', 'extract-article'],
        }),
      })),
    );
    const { probeHelper } = await import('./helper-client');
    const result = await probeHelper('http://127.0.0.1:47826');
    expect(result).toEqual({
      status: 'available',
      version: '0.2.4',
      features: ['fetch-image', 'extract-article'],
    });
  });

  it('reports unavailable when /ping returns a non-bsky-saves payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: 'something-else' }),
      })),
    );
    const { probeHelper } = await import('./helper-client');
    expect(await probeHelper('http://127.0.0.1:47826')).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when /ping returns non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const { probeHelper } = await import('./helper-client');
    expect(await probeHelper('http://127.0.0.1:47826')).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when fetch rejects (no helper running)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { probeHelper } = await import('./helper-client');
    expect(await probeHelper('http://127.0.0.1:47826')).toEqual({ status: 'unavailable' });
  });

  it('strips a trailing slash from the origin before appending /ping', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { probeHelper } = await import('./helper-client');
    await probeHelper('http://127.0.0.1:47826/');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:47826/ping', expect.any(Object));
  });

  it('surfaces protocol + gui_bundled when v0.6.1+ /ping returns them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          name: 'bsky-saves',
          version: '0.6.1',
          protocol: '1',
          gui_bundled: '0.6.0',
          features: ['fetch', 'enrich', 'hydrate-threads', 'fetch-image', 'extract-article', 'jwt-credentials'],
        }),
      })),
    );
    const { probeHelper } = await import('./helper-client');
    const result = await probeHelper('http://127.0.0.1:47826');
    expect(result).toMatchObject({
      status: 'available',
      version: '0.6.1',
      protocol: '1',
      gui_bundled: '0.6.0',
    });
  });

  it('surfaces gui_bundled: null for dev-install helpers that skipped the GUI-fetch build hook', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          name: 'bsky-saves',
          version: '0.6.1',
          protocol: '1',
          gui_bundled: null,
          features: [],
        }),
      })),
    );
    const { probeHelper } = await import('./helper-client');
    const result = await probeHelper('http://127.0.0.1:47826');
    expect(result).toMatchObject({ status: 'available', gui_bundled: null });
  });

  it('omits the optional fields when the helper does not return them (v0.6.0 compat)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          name: 'bsky-saves',
          version: '0.6.0',
          features: [],
        }),
      })),
    );
    const { probeHelper } = await import('./helper-client');
    const result = await probeHelper('http://127.0.0.1:47826');
    expect(result).toEqual({
      status: 'available',
      version: '0.6.0',
      features: [],
    });
  });

  it('reports unavailable when /ping returns protocol with the wrong type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          name: 'bsky-saves',
          version: '0.6.1',
          protocol: 1, // number, not string — wire-format violation
          features: [],
        }),
      })),
    );
    const { probeHelper } = await import('./helper-client');
    expect(await probeHelper('http://127.0.0.1:47826')).toEqual({ status: 'unavailable' });
  });
});

describe('helper-client fetchImageViaHelper', () => {
  it('POSTs the URL as JSON and returns the response body as a Blob', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
      blob: async () => new Blob(['IMG'], { type: 'image/png' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchImageViaHelper } = await import('./helper-client');
    const blob = await fetchImageViaHelper('http://127.0.0.1:47826', 'https://cdn.bsky.app/img/foo.jpg');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/fetch-image',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: 'https://cdn.bsky.app/img/foo.jpg' }),
      }),
    );
  });

  it('throws on non-2xx response with the upstream status in the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, blob: async () => new Blob() })));
    const { fetchImageViaHelper } = await import('./helper-client');
    await expect(
      fetchImageViaHelper('http://127.0.0.1:47826', 'https://cdn.bsky.app/img/foo.jpg'),
    ).rejects.toThrow(/502/);
  });

  it('throws on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { fetchImageViaHelper } = await import('./helper-client');
    await expect(
      fetchImageViaHelper('http://127.0.0.1:47826', 'https://cdn.bsky.app/img/foo.jpg'),
    ).rejects.toThrow();
  });

  it('rejects non-image content-types', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) },
      blob: async () => new Blob(['<script>'], { type: 'text/html' }),
    })));
    const { fetchImageViaHelper } = await import('./helper-client');
    await expect(
      fetchImageViaHelper('http://127.0.0.1:47826', 'https://cdn.bsky.app/img/foo.jpg'),
    ).rejects.toThrow(/non-image/);
  });

  it('rejects oversized announced content-length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: {
        get: (h: string) => {
          const k = h.toLowerCase();
          if (k === 'content-type') return 'image/png';
          if (k === 'content-length') return String(100 * 1024 * 1024);
          return null;
        },
      },
      blob: async () => new Blob(['IMG'], { type: 'image/png' }),
    })));
    const { fetchImageViaHelper } = await import('./helper-client');
    await expect(
      fetchImageViaHelper('http://127.0.0.1:47826', 'https://cdn.bsky.app/img/foo.jpg'),
    ).rejects.toThrow(/cap/);
  });
});

describe('helper-client extractArticleViaHelper', () => {
  it('POSTs the URL as JSON and returns the parsed envelope', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        url: 'https://example.com/post',
        title: 'A great post',
        text: 'Body of the article.',
        fetched_at: '2026-05-04T12:00:00Z',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { extractArticleViaHelper } = await import('./helper-client');
    const result = await extractArticleViaHelper(
      'http://127.0.0.1:47826',
      'https://example.com/post',
    );
    expect(result).toEqual({
      url: 'https://example.com/post',
      title: 'A great post',
      text: 'Body of the article.',
      fetched_at: '2026-05-04T12:00:00Z',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/extract-article',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: 'https://example.com/post' }),
      }),
    );
  });

  it('returns {note} when the helper indicates no extractable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          url: 'https://example.com/paywall',
          title: '',
          text: '',
          fetched_at: '2026-05-04T12:00:00Z',
          note: 'no extractable body',
        }),
      })),
    );
    const { extractArticleViaHelper } = await import('./helper-client');
    const result = await extractArticleViaHelper(
      'http://127.0.0.1:47826',
      'https://example.com/paywall',
    );
    expect(result.note).toBe('no extractable body');
    expect(result.text).toBe('');
  });

  it('throws on non-2xx with status in the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) })),
    );
    const { extractArticleViaHelper } = await import('./helper-client');
    await expect(
      extractArticleViaHelper('http://127.0.0.1:47826', 'https://example.com/x'),
    ).rejects.toThrow(/502/);
  });

  it('throws on malformed envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ unexpected: true }) })),
    );
    const { extractArticleViaHelper } = await import('./helper-client');
    await expect(
      extractArticleViaHelper('http://127.0.0.1:47826', 'https://example.com/x'),
    ).rejects.toThrow(/malformed/i);
  });

  it('throws on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { extractArticleViaHelper } = await import('./helper-client');
    await expect(
      extractArticleViaHelper('http://127.0.0.1:47826', 'https://example.com/x'),
    ).rejects.toThrow();
  });
});

describe('fetchSaves (app-password)', () => {
  it('POSTs to /fetch with the app-password credential shape', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ saves: [], cursor: null }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSaves } = await import('./helper-client');
    const out = await fetchSaves('http://localhost:47826', {
      credentials: { handle: 'a.bsky.social', appPassword: 'pw', pds: 'https://bsky.social' },
      cursor: null,
      limit: 100,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:47826/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: { handle: 'a.bsky.social', app_password: 'pw', pds: 'https://bsky.social' },
          cursor: null,
          limit: 100,
        }),
      }),
    );
    expect(out).toEqual({ saves: [], cursor: null });
    vi.unstubAllGlobals();
  });

  it('throws on 400 missing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'missing credentials' }), { status: 400 }),
    ));
    const { fetchSaves } = await import('./helper-client');
    await expect(fetchSaves('http://x', {
      credentials: { handle: '', appPassword: '', pds: '' },
      cursor: null, limit: 100,
    })).rejects.toThrow(/missing credentials/);
    vi.unstubAllGlobals();
  });

  it('throws on 401 createSession failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'createSession failed: bad pw' }), { status: 401 }),
    ));
    const { fetchSaves } = await import('./helper-client');
    await expect(fetchSaves('http://x', {
      credentials: { handle: 'a', appPassword: 'b', pds: 'c' },
      cursor: null, limit: 100,
    })).rejects.toThrow(/createSession failed/);
    vi.unstubAllGlobals();
  });

  it('throws on 400 invalid cursor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid cursor' }), { status: 400 }),
    ));
    const { fetchSaves } = await import('./helper-client');
    await expect(fetchSaves('http://x', {
      credentials: { handle: 'a', appPassword: 'b', pds: 'c' },
      cursor: 'corrupt', limit: 100,
    })).rejects.toThrow(/invalid cursor/);
    vi.unstubAllGlobals();
  });
});

describe('fetchSaves (jwt-pair)', () => {
  it('POSTs the JWT-pair credential shape (snake_case keys)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ saves: [], cursor: null }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSaves } = await import('./helper-client');
    await fetchSaves('http://x', {
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1', pds: 'https://bsky.social' },
      cursor: null,
      limit: 100,
    });

    expect(fetchMock).toHaveBeenCalledWith('http://x/fetch', expect.objectContaining({
      body: JSON.stringify({
        credentials: { access_jwt: 'A', refresh_jwt: 'R', did: 'did:plc:1', pds: 'https://bsky.social' },
        cursor: null,
        limit: 100,
      }),
    }));
    vi.unstubAllGlobals();
  });

  it('returns rotated_credentials when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({
        saves: [],
        cursor: 'c1',
        rotated_credentials: { access_jwt: 'A2', refresh_jwt: 'R2', did: 'did:plc:1' },
      }), { status: 200 }),
    ));

    const { fetchSaves } = await import('./helper-client');
    const out = await fetchSaves('http://x', {
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
      cursor: null, limit: 100,
    });

    expect(out.rotated_credentials).toEqual({ access_jwt: 'A2', refresh_jwt: 'R2', did: 'did:plc:1' });
    vi.unstubAllGlobals();
  });

  it('rotated_credentials absent when refresh did not happen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ saves: [], cursor: null }), { status: 200 }),
    ));
    const { fetchSaves } = await import('./helper-client');
    const out = await fetchSaves('http://x', {
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
      cursor: null, limit: 100,
    });
    expect(out.rotated_credentials).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('throws on 401 auth refresh failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'auth refresh failed', code: 'refresh_failed' }), { status: 401 }),
    ));
    const { fetchSaves } = await import('./helper-client');
    await expect(fetchSaves('http://x', {
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
      cursor: null, limit: 100,
    })).rejects.toThrow(/auth refresh failed/);
    vi.unstubAllGlobals();
  });
});

describe('enrichUris', () => {
  it('POSTs to /enrich with uris (no credentials)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ enriched: [{ uri: 'at://x', post_created_at: '2026-01-01T00:00:00Z' }], errors: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { enrichUris } = await import('./helper-client');
    const out = await enrichUris('http://x', { uris: ['at://x'] });

    expect(fetchMock).toHaveBeenCalledWith('http://x/enrich', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ uris: ['at://x'] }),
    }));
    expect(out.enriched).toHaveLength(1);
    expect(out.errors).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('throws on 400 missing uris', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'missing uris' }), { status: 400 }),
    ));
    const { enrichUris } = await import('./helper-client');
    await expect(enrichUris('http://x', { uris: [] as unknown as string[] })).rejects.toThrow(/missing uris/);
    vi.unstubAllGlobals();
  });
});

describe('hydrateThreads', () => {
  it('POSTs uris and credentials to /hydrate-threads', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ threaded: [], errors: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { hydrateThreads } = await import('./helper-client');
    await hydrateThreads('http://x', {
      uris: ['at://a'],
      credentials: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1' },
    });

    expect(fetchMock).toHaveBeenCalledWith('http://x/hydrate-threads', expect.objectContaining({
      body: JSON.stringify({
        uris: ['at://a'],
        credentials: { access_jwt: 'A', refresh_jwt: 'R', did: 'did:plc:1' },
      }),
    }));
    vi.unstubAllGlobals();
  });

  it('throws on 400 missing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'missing credentials' }), { status: 400 }),
    ));
    const { hydrateThreads } = await import('./helper-client');
    await expect(hydrateThreads('http://x', {
      uris: ['at://a'],
      credentials: { handle: '', appPassword: '', pds: '' },
    })).rejects.toThrow(/missing credentials/);
    vi.unstubAllGlobals();
  });
});

describe('helper-client Authorization header (pairing)', () => {
  // The 5 authed wrappers all share withAuthHeaders(); we spot-check two
  // representative endpoints (enrich → JSON POST, fetch-image → JSON POST
  // returning bytes) for both pairing states. The others are mechanically
  // identical.
  const VALID_TOKEN = 'tok_' + 'a'.repeat(20); // 24 chars, base64url-shaped

  it('omits Authorization when the GUI is unpaired', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ enriched: [], errors: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const { enrichUris } = await import('./helper-client');
    await enrichUris('http://127.0.0.1:47826', { uris: ['at://a'] });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/enrich',
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      }),
    );
  });

  it('sets Authorization: Bearer <token> when paired (enrich)', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ enriched: [], errors: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const { setPairingToken } = await import('./pairing-token');
    setPairingToken(VALID_TOKEN);
    const { enrichUris } = await import('./helper-client');
    await enrichUris('http://127.0.0.1:47826', { uris: ['at://a'] });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/enrich',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${VALID_TOKEN}` }),
      }),
    );
  });

  it('sets Authorization: Bearer <token> when paired (fetch-image)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
      blob: async () => new Blob(['IMG'], { type: 'image/png' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { setPairingToken } = await import('./pairing-token');
    setPairingToken(VALID_TOKEN);
    const { fetchImageViaHelper } = await import('./helper-client');
    await fetchImageViaHelper('http://127.0.0.1:47826', 'https://cdn.bsky.app/img/foo.jpg');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/fetch-image',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${VALID_TOKEN}` }),
      }),
    );
  });

  it('keeps sending the token when state is stale', async () => {
    // Stale = the helper rejected the token but we keep it around so a
    // re-pair can replace it. Until then, no harm in continuing to send;
    // the helper will keep 401ing, which is cheap and stable.
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ enriched: [], errors: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const { setPairingToken, markPairingStale } = await import('./pairing-token');
    setPairingToken(VALID_TOKEN);
    markPairingStale();
    const { enrichUris } = await import('./helper-client');
    await enrichUris('http://127.0.0.1:47826', { uris: ['at://a'] });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/enrich',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${VALID_TOKEN}` }),
      }),
    );
  });
});

describe('helper-client 401 handling (pairing-cause detection)', () => {
  const VALID_TOKEN = 'tok_' + 'a'.repeat(20);

  it('marks pairing stale on 401 with WWW-Authenticate: Bearer realm="bsky-saves" (missing-header sub-case)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'authentication required' }), {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="bsky-saves"' },
      })),
    );
    const { setPairingToken, pairingToken } = await import('./pairing-token');
    const { get } = await import('svelte/store');
    setPairingToken(VALID_TOKEN);
    const { enrichUris } = await import('./helper-client');
    await expect(
      enrichUris('http://127.0.0.1:47826', { uris: ['at://a'] }),
    ).rejects.toThrow();
    expect(get(pairingToken).state).toBe('stale');
  });

  it('marks pairing stale on 401 with WWW-Authenticate carrying error="invalid_token" (wrong-token sub-case)', async () => {
    // Recovery is identical for missing-header vs wrong-token per the
    // bsky-saves v0.6.2 spec §5; this test pins that we route the
    // RFC-6750-preferred `error="invalid_token"` variant through the
    // same path.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'authentication required' }), {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer realm="bsky-saves", error="invalid_token"',
        },
      })),
    );
    const { setPairingToken, pairingToken } = await import('./pairing-token');
    const { get } = await import('svelte/store');
    setPairingToken(VALID_TOKEN);
    const { enrichUris } = await import('./helper-client');
    await expect(
      enrichUris('http://127.0.0.1:47826', { uris: ['at://a'] }),
    ).rejects.toThrow();
    expect(get(pairingToken).state).toBe('stale');
  });

  it('leaves pairing state alone on 401 without WWW-Authenticate (upstream-cause)', async () => {
    // This is the existing "helper proxied an upstream PDS auth failure"
    // shape — the helper itself authed us correctly but our credentials
    // were rejected at the next hop. Marking pairingStale here would
    // mislead the user.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'createSession failed' }), {
        status: 401,
      })),
    );
    const { setPairingToken, pairingToken } = await import('./pairing-token');
    const { get } = await import('svelte/store');
    setPairingToken(VALID_TOKEN);
    const { enrichUris } = await import('./helper-client');
    await expect(
      enrichUris('http://127.0.0.1:47826', { uris: ['at://a'] }),
    ).rejects.toThrow();
    expect(get(pairingToken).state).toBe('paired'); // unchanged
  });

  it('does not flip state when 401 fires without a sent Authorization header', async () => {
    // Unpaired GUI + helper requires auth. The 401 is expected and the
    // pairing flow recovers via the banner (no token to mark "stale");
    // there's nothing the 401 handler can do that the banner isn't
    // already doing, so it should no-op.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      })),
    );
    // No setPairingToken — state starts 'unpaired'.
    const { pairingToken } = await import('./pairing-token');
    const { get } = await import('svelte/store');
    const { enrichUris } = await import('./helper-client');
    await expect(
      enrichUris('http://127.0.0.1:47826', { uris: ['at://a'] }),
    ).rejects.toThrow();
    expect(get(pairingToken).state).toBe('unpaired'); // unchanged
  });
});

describe('probePairingToken (verify endpoint)', () => {
  // Hits GET /auth/check on bsky-saves v0.6.3+. The mocked fetch
  // shapes match what the helper actually returns: 200 empty on valid,
  // 401 with WWW-Authenticate: Bearer on missing/wrong token, 403 for
  // policy violations (origin allowlist), other 4xx/5xx for everything
  // else.
  const VALID_TOKEN = 'tok_' + 'a'.repeat(20);

  it('returns "valid" on 200', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { probePairingToken } = await import('./helper-client');
    expect(await probePairingToken('http://127.0.0.1:47826', VALID_TOKEN)).toBe('valid');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/auth/check',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${VALID_TOKEN}` }),
      }),
    );
  });

  it('returns "rejected" on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="bsky-saves"' },
    })));
    const { probePairingToken } = await import('./helper-client');
    expect(await probePairingToken('http://127.0.0.1:47826', VALID_TOKEN)).toBe('rejected');
  });

  it('returns "rejected" on 403 (origin allowlist failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    const { probePairingToken } = await import('./helper-client');
    expect(await probePairingToken('http://127.0.0.1:47826', VALID_TOKEN)).toBe('rejected');
  });

  it('returns "unreachable" on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const { probePairingToken } = await import('./helper-client');
    expect(await probePairingToken('http://127.0.0.1:47826', VALID_TOKEN)).toBe('unreachable');
  });

  it('returns "unreachable" on 5xx (helper alive but misbehaving)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const { probePairingToken } = await import('./helper-client');
    expect(await probePairingToken('http://127.0.0.1:47826', VALID_TOKEN)).toBe('unreachable');
  });

  it('strips a trailing slash from the origin', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { probePairingToken } = await import('./helper-client');
    await probePairingToken('http://127.0.0.1:47826/', VALID_TOKEN);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47826/auth/check',
      expect.any(Object),
    );
  });
});
