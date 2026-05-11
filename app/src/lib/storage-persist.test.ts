import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { writable } from 'svelte/store';
import { initStoragePersist, _resetForTests } from './storage-persist';
import type { PersistenceMode } from './persistence-mode';

let persistFn: ReturnType<typeof vi.fn>;
let originalStorage: StorageManager | undefined;

beforeEach(() => {
  _resetForTests();
  persistFn = vi.fn(async () => true);
  originalStorage = (navigator as unknown as { storage?: StorageManager }).storage;
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persist: persistFn } as unknown as StorageManager,
  });
});

afterEach(() => {
  if (originalStorage === undefined) {
    delete (navigator as unknown as { storage?: StorageManager }).storage;
  } else {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: originalStorage,
    });
  }
});

describe('initStoragePersist', () => {
  it('calls navigator.storage.persist() when mode starts as persist', async () => {
    const mode = writable<PersistenceMode>('persist');
    initStoragePersist({ persistenceMode: { subscribe: mode.subscribe } });
    await Promise.resolve();
    expect(persistFn).toHaveBeenCalledTimes(1);
  });

  it('does NOT call persist() when mode is session-only', async () => {
    const mode = writable<PersistenceMode>('session-only');
    initStoragePersist({ persistenceMode: { subscribe: mode.subscribe } });
    await Promise.resolve();
    expect(persistFn).not.toHaveBeenCalled();
  });

  it('calls persist() at most once per page (idempotent across flips)', async () => {
    const mode = writable<PersistenceMode>('persist');
    initStoragePersist({ persistenceMode: { subscribe: mode.subscribe } });
    await Promise.resolve();
    mode.set('session-only');
    mode.set('persist');
    mode.set('session-only');
    mode.set('persist');
    await Promise.resolve();
    expect(persistFn).toHaveBeenCalledTimes(1);
  });

  it('calls persist() on the first session-only → persist flip', async () => {
    const mode = writable<PersistenceMode>('session-only');
    initStoragePersist({ persistenceMode: { subscribe: mode.subscribe } });
    await Promise.resolve();
    expect(persistFn).not.toHaveBeenCalled();
    mode.set('persist');
    await Promise.resolve();
    expect(persistFn).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when navigator.storage is unsupported', async () => {
    delete (navigator as unknown as { storage?: StorageManager }).storage;
    const mode = writable<PersistenceMode>('persist');
    expect(() =>
      initStoragePersist({ persistenceMode: { subscribe: mode.subscribe } }),
    ).not.toThrow();
    await Promise.resolve();
  });

  it('swallows persist() rejections silently', async () => {
    persistFn.mockRejectedValueOnce(new Error('denied'));
    const mode = writable<PersistenceMode>('persist');
    expect(() =>
      initStoragePersist({ persistenceMode: { subscribe: mode.subscribe } }),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(persistFn).toHaveBeenCalledTimes(1);
  });
});
