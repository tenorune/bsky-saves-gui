import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  const { clearProxyConfig } = await import('./proxy-config');
  await clearProxyConfig();
  const { clearBackupPrefs } = await import('./backup-prefs');
  await clearBackupPrefs();
});

describe('detectBackends', () => {
  it('returns helper first when both helper and user-worker are configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: ['fetch-image'] }),
      })),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['helper', 'user-worker']);
  });

  it('omits the helper when probe fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['user-worker']);
  });

  it('omits user-worker when proxy config is unset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: ['fetch-image'] }),
      })),
    );
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['helper']);
  });

  it('returns an empty list when nothing is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { detectBackends } = await import('./image-fetcher');
    expect(await detectBackends()).toEqual([]);
  });
});

describe('fetchImage', () => {
  it('uses the helper when available', async () => {
    // First call (probe) returns ping payload; second call (fetch-image) returns blob.
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string) => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: ['fetch-image'] }),
          };
        }
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          blob: async () => new Blob(['IMG'], { type: 'image/png' }),
        };
      }),
    );
    const { fetchImage } = await import('./image-fetcher');
    const blob = await fetchImage('https://cdn.bsky.app/img/foo.jpg');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });

  it('falls back to user-worker when helper is not running', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new TypeError('Failed to fetch'); // helper probe fails
        return {
          ok: true,
          json: async () => ({ status: 200, headers: { 'content-type': 'image/png' }, body_b64: btoa('IMG') }),
        };
      }),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { fetchImage } = await import('./image-fetcher');
    const blob = await fetchImage('https://cdn.bsky.app/img/foo.jpg');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });

  it('throws NoBackendsAvailable when nothing is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { fetchImage, NoBackendsAvailableError } = await import('./image-fetcher');
    await expect(fetchImage('https://x/y')).rejects.toBeInstanceOf(NoBackendsAvailableError);
  });
});

describe('operator-proxy backend', () => {
  it('detectBackends includes operator-proxy when configured at build time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch'); // helper probe fails
      }),
    );
    vi.doMock('./config', () => ({
      config: {
        helperOrigin: 'http://127.0.0.1:47826',
        operatorImageProxyUrl: 'https://operator.example/fetch',
        operatorImageProxySecret: 'op-secret',
      },
    }));
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['operator-proxy']);
    vi.doUnmock('./config');
  });

  it('detectBackends orders operator-proxy AFTER user-worker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    vi.doMock('./config', () => ({
      config: {
        helperOrigin: 'http://127.0.0.1:47826',
        operatorImageProxyUrl: 'https://operator.example/fetch',
        operatorImageProxySecret: 'op-secret',
      },
    }));
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual(['user-worker', 'operator-proxy']);
    vi.doUnmock('./config');
  });

  it('detectBackends omits operator-proxy when not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    // Default config (test setup) has empty operator URL.
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).not.toContain('operator-proxy');
  });

  it('respects operatorProxyOptOut: omits operator-proxy when opted out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    vi.doMock('./config', () => ({
      config: {
        helperOrigin: 'http://127.0.0.1:47826',
        operatorImageProxyUrl: 'https://operator.example/fetch',
        operatorImageProxySecret: 'op-secret',
      },
    }));
    const { setOperatorProxyOptOut } = await import('./backup-prefs');
    await setOperatorProxyOptOut(true);
    const { detectBackends } = await import('./image-fetcher');
    const backends = await detectBackends();
    expect(backends.map((b) => b.kind)).toEqual([]);
    vi.doUnmock('./config');
  });
});
