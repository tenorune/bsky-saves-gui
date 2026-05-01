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
    });
    expect(await loadProxyConfig()).toEqual({
      url: 'https://my-proxy.user.workers.dev',
      sharedSecret: 'sek',
    });
  });

  it('clearProxyConfig wipes the entry', async () => {
    const { saveProxyConfig, loadProxyConfig, clearProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://x', sharedSecret: 's' });
    await clearProxyConfig();
    expect(await loadProxyConfig()).toBeNull();
  });
});
