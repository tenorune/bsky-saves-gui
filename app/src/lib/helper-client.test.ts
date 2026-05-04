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
