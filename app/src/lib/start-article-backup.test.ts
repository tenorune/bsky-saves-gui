import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  const { clearInventory } = await import('./inventory-store');
  await clearInventory();
  const { resetArticleHydration } = await import('./hydration-state');
  resetArticleHydration();
  const { clearOperatorProxyOptOut } = await import('./operator-proxy-opt-out');
  await clearOperatorProxyOptOut();
  const { clearProxyConfig } = await import('./proxy-config');
  await clearProxyConfig();
});

const okPing = {
  ok: true,
  json: async () => ({
    name: 'bsky-saves',
    version: '0.3.0',
    features: ['fetch-image', 'extract-article'],
  }),
};

const okExtract = {
  ok: true,
  json: async () => ({
    url: 'https://example.com/a',
    title: 't',
    text: 'body',
    fetched_at: '2026-05-04T12:00:00Z',
  }),
};

const sampleInventory = () => ({
  saves: [{ uri: 'a', embed: { url: 'https://example.com/a' } }],
});

describe('startArticleBackup', () => {
  it('returns {started: false, reason} when the helper is not running and no worker is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { startArticleBackup } = await import('./start-article-backup');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/no article backend available/i);
  });

  it('returns {started: true} when helper is available and runs the loop', async () => {
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing;
        return okExtract;
      }),
    );
    const { startArticleBackup } = await import('./start-article-backup');
    const { articleHydration } = await import('./hydration-state');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(true);
    await vi.waitUntil(() => get(articleHydration).status === 'done', { timeout: 1000 });
    expect(get(articleHydration).fetched).toBe(1);
  });

  it('cancelArticleBackup aborts the run', async () => {
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing;
        await new Promise((r) => setTimeout(r, 50));
        return okExtract;
      }),
    );
    const { startArticleBackup, cancelArticleBackup } = await import('./start-article-backup');
    const { articleHydration } = await import('./hydration-state');
    const inv = {
      saves: [
        { uri: '1', embed: { url: 'https://example.com/1' } },
        { uri: '2', embed: { url: 'https://example.com/2' } },
        { uri: '3', embed: { url: 'https://example.com/3' } },
      ],
    };
    const result = await startArticleBackup(inv);
    expect(result.started).toBe(true);
    await vi.waitUntil(() => get(articleHydration).fetched >= 1, { timeout: 1000 });
    cancelArticleBackup();
    await vi.waitUntil(() => get(articleHydration).status === 'cancelled', { timeout: 1000 });
  });

  it('cancelArticleBackup is a safe no-op when nothing is running', async () => {
    const { cancelArticleBackup } = await import('./start-article-backup');
    expect(() => cancelArticleBackup()).not.toThrow();
  });

  it('returns {started: true} when helper is absent but worker supportsArticles', async () => {
    let extractCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const u = typeof input === 'string' ? input : (input as Request).url;
        if (u.endsWith('/ping')) throw new TypeError('Failed to fetch');
        if (u.endsWith('/extract-article')) {
          extractCalls++;
          return {
            ok: true,
            json: async () => ({
              url: 'https://example.com/a',
              title: 't',
              text: 'body',
              fetched_at: '2026-05-04T12:00:00Z',
            }),
          };
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
    const { startArticleBackup } = await import('./start-article-backup');
    const { articleHydration } = await import('./hydration-state');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(true);
    await vi.waitUntil(() => get(articleHydration).status === 'done', { timeout: 1000 });
    expect(get(articleHydration).fetched).toBe(1);
    expect(extractCalls).toBe(1);
  });

  it('returns {started: false} with the unified reason when neither helper nor worker is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { clearProxyConfig } = await import('./proxy-config');
    await clearProxyConfig();
    const { startArticleBackup } = await import('./start-article-backup');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/no article backend available/i);
  });

  it('returns {started: false} when proxy config exists but supportsArticles is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: false });
    const { startArticleBackup } = await import('./start-article-backup');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/no article backend available/i);
  });
});
