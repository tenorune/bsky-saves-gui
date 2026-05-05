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

const okPing = {
  ok: true,
  json: async () => ({
    name: 'bsky-saves',
    version: '0.3.0',
    features: ['fetch-image', 'extract-article'],
  }),
};

describe('describeAvailableImageBackend', () => {
  it('returns null when no backend is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { describeAvailableImageBackend } = await import('./describe-backend');
    expect(await describeAvailableImageBackend()).toBeNull();
  });

  it('describes the local helper when available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okPing));
    const { describeAvailableImageBackend } = await import('./describe-backend');
    const result = await describeAvailableImageBackend();
    expect(result).toMatch(/local helper/i);
    expect(result).toMatch(/0\.3\.0/);
  });

  it('describes the user-worker when configured and helper is offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://my.workers.dev', sharedSecret: 's' });
    const { describeAvailableImageBackend } = await import('./describe-backend');
    const result = await describeAvailableImageBackend();
    expect(result).toMatch(/custom cloudflare worker/i);
  });

  it('describes the operator proxy as last resort', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    vi.doMock('./config', () => ({
      config: {
        helperOrigin: 'http://127.0.0.1:47826',
        operatorImageProxyUrl: 'https://operator.example/fetch',
        operatorImageProxySecret: 'op-secret',
      },
    }));
    const { describeAvailableImageBackend } = await import('./describe-backend');
    const result = await describeAvailableImageBackend();
    expect(result).toMatch(/operator/i);
    vi.doUnmock('./config');
  });
});

describe('describeArticleBackend', () => {
  it('returns {available: false} when helper is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { describeArticleBackend } = await import('./describe-backend');
    const result = await describeArticleBackend();
    expect(result.available).toBe(false);
  });

  it('returns {available: true, description} when helper advertises extract-article', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okPing));
    const { describeArticleBackend } = await import('./describe-backend');
    const result = await describeArticleBackend();
    expect(result.available).toBe(true);
    expect(result.description).toMatch(/local helper/i);
  });

  it('returns {available: false} when helper is up but lacks extract-article', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          name: 'bsky-saves',
          version: '0.2.0',
          features: ['fetch-image'], // no extract-article
        }),
      })),
    );
    const { describeArticleBackend } = await import('./describe-backend');
    const result = await describeArticleBackend();
    expect(result.available).toBe(false);
  });
});
