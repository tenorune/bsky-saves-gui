import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('proxyConfig', () => {
  beforeEach(async () => {
    const { clearProxyConfig } = await import('./proxy-config');
    await clearProxyConfig();
  });

  it('returns null when nothing is stored', async () => {
    const { loadProxyConfig } = await import('./proxy-config');
    expect(await loadProxyConfig()).toBeNull();
  });

  it('round-trips a saved config', async () => {
    const { saveProxyConfig, loadProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({
      url: 'https://my-proxy.user.workers.dev',
      sharedSecret: 'sek',
      supportsArticles: false,
    });
    expect(await loadProxyConfig()).toEqual({
      url: 'https://my-proxy.user.workers.dev',
      sharedSecret: 'sek',
      supportsArticles: false,
    });
  });

  it('clearProxyConfig wipes the entry', async () => {
    const { saveProxyConfig, loadProxyConfig, clearProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://x', sharedSecret: 's', supportsArticles: false });
    await clearProxyConfig();
    expect(await loadProxyConfig()).toBeNull();
  });

  it('round-trips supportsArticles', async () => {
    const { saveProxyConfig, loadProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
    const loaded = await loadProxyConfig();
    expect(loaded).toEqual({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
  });

  it('defaults supportsArticles to false for legacy stored configs', async () => {
    // Simulate a config saved before the field existed.
    const { set } = await import('idb-keyval');
    const { loadProxyConfig } = await import('./proxy-config');
    await set('proxy-config:v1', { url: 'https://w.example/', sharedSecret: 's' });
    const loaded = await loadProxyConfig();
    expect(loaded).toEqual({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: false });
  });
});
