import { describe, expect, it, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.unstubAllGlobals();
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
