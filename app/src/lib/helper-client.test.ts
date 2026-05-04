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
