import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';

// See image-fetcher.test.ts for the rationale. Tests that need a
// configured operator proxy override via vi.doMock after vi.resetModules.
vi.mock('./config', () => ({
  config: {
    helperOrigin: 'http://127.0.0.1:47826',
    operatorImageProxyUrl: '',
    operatorImageProxySecret: '',
  },
}));

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
  const { clearProxyConfig } = await import('./proxy-config');
  await clearProxyConfig();
  const { resetImageHydration } = await import('./hydration-state');
  resetImageHydration();
  const { clearBackupPrefs } = await import('./backup-prefs');
  await clearBackupPrefs();
});

const okPing = {
  ok: true,
  json: async () => ({ name: 'bsky-saves', version: '0.2.4', features: ['fetch-image'] }),
};

describe('startImageBackup', () => {
  it('returns {started: false, reason} when no backend is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch'); // helper probe fails
      }),
    );
    const { startImageBackup } = await import('./start-image-backup');
    const result = await startImageBackup({ saves: [{ images: [{ url: 'https://x/1' }] }] });
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/No backup method/i);
  });

  it('returns {started: true} when a helper is available and starts the loop', async () => {
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing; // backend probe
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          blob: async () => new Blob(['IMG'], { type: 'image/png' }),
        };
      }),
    );
    const { startImageBackup } = await import('./start-image-backup');
    const { imageHydration } = await import('./hydration-state');

    const result = await startImageBackup({
      saves: [{ images: [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }] }],
    });
    expect(result).toEqual({ started: true });

    // Wait for the background loop to finish; total === fetched once it's done.
    await vi.waitUntil(() => get(imageHydration).status === 'done', { timeout: 1000 });
    const final = get(imageHydration);
    expect(final.total).toBe(2);
    expect(final.fetched).toBe(2);
    expect(final.failed).toBe(0);
  });

  it('cancelImageBackup aborts a running loop', async () => {
    // Helper probe + then a fetch that takes a few microtasks (so we can
    // cancel between iterations).
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing;
        await new Promise((r) => setTimeout(r, 50));
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          blob: async () => new Blob(['IMG'], { type: 'image/png' }),
        };
      }),
    );
    const { startImageBackup, cancelImageBackup } = await import('./start-image-backup');
    const { imageHydration } = await import('./hydration-state');

    const result = await startImageBackup({
      saves: [
        { images: [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }, { url: 'https://x/3.jpg' }] },
      ],
    });
    expect(result.started).toBe(true);

    // Wait until at least one image has been processed, then cancel.
    await vi.waitUntil(() => get(imageHydration).fetched >= 1, { timeout: 1000 });
    cancelImageBackup();

    await vi.waitUntil(() => get(imageHydration).status === 'cancelled', { timeout: 1000 });
    const final = get(imageHydration);
    expect(final.status).toBe('cancelled');
    expect(final.fetched).toBeLessThan(3);
  });

  it('cancelImageBackup is a safe no-op when nothing is running', async () => {
    const { cancelImageBackup } = await import('./start-image-backup');
    expect(() => cancelImageBackup()).not.toThrow();
  });

  it('sets backup-prefs.images.enabled = true on successful start', async () => {
    let pingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        pingCalls++;
        if (pingCalls === 1) return okPing;
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          blob: async () => new Blob(['IMG'], { type: 'image/png' }),
        };
      }),
    );
    const { startImageBackup } = await import('./start-image-backup');
    const { loadBackupPrefs } = await import('./backup-prefs');

    const result = await startImageBackup({
      saves: [{ images: [{ url: 'https://x/1.jpg' }] }],
    });
    expect(result.started).toBe(true);

    // Wait long enough for the fire-and-forget enable write to land.
    await vi.waitUntil(async () => (await loadBackupPrefs()).images.enabled, { timeout: 1000 });
    expect((await loadBackupPrefs()).images.enabled).toBe(true);
  });

  it('does NOT flip enabled when started is false (no backend)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { startImageBackup } = await import('./start-image-backup');
    const { loadBackupPrefs } = await import('./backup-prefs');

    const result = await startImageBackup({ saves: [{ images: [{ url: 'https://x/1.jpg' }] }] });
    expect(result.started).toBe(false);
    expect((await loadBackupPrefs()).images.enabled).toBe(false);
  });
});
