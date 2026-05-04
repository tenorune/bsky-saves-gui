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
  it('returns {started: false, reason} when the helper is not running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { startArticleBackup } = await import('./start-article-backup');
    const result = await startArticleBackup(sampleInventory());
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/helper/i);
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

  it('flips backup-prefs.articles.enabled = true on successful start', async () => {
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
    const { loadBackupPrefs } = await import('./backup-prefs');
    await startArticleBackup(sampleInventory());
    await vi.waitUntil(async () => (await loadBackupPrefs()).articles.enabled, { timeout: 1000 });
    expect((await loadBackupPrefs()).articles.enabled).toBe(true);
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
});
