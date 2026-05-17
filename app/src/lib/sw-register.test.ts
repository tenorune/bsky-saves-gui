import { describe, it, expect, vi } from 'vitest';
import { handleRegistration, isLoopbackHost, cleanupServiceWorker } from './sw-register';

type Listener = () => void;

function makeWorker(initialState: ServiceWorker['state']) {
  const listeners: Record<string, Listener[]> = {};
  return {
    state: initialState,
    postMessage: vi.fn(),
    addEventListener: vi.fn((evt: string, cb: Listener) => {
      (listeners[evt] = listeners[evt] ?? []).push(cb);
    }),
    removeEventListener: vi.fn(),
    dispatch(evt: string) {
      (listeners[evt] ?? []).forEach((cb) => cb());
    },
  } as unknown as ServiceWorker & { dispatch(evt: string): void };
}

function makeRegistration(opts: {
  waiting?: ServiceWorker | null;
  installing?: ServiceWorker | null;
}) {
  const listeners: Record<string, Listener[]> = {};
  return {
    waiting: opts.waiting ?? null,
    installing: opts.installing ?? null,
    addEventListener: vi.fn((evt: string, cb: Listener) => {
      (listeners[evt] = listeners[evt] ?? []).push(cb);
    }),
    dispatch(evt: string) {
      (listeners[evt] ?? []).forEach((cb) => cb());
    },
  } as unknown as ServiceWorkerRegistration & { dispatch(evt: string): void };
}

describe('isLoopbackHost', () => {
  it('returns true for "localhost"', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
  });

  it('returns true for "127.0.0.1"', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
  });

  it('returns false for the hosted PWA hostname', () => {
    expect(isLoopbackHost('saves.lightseed.net')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isLoopbackHost('')).toBe(false);
  });

  it('returns false for arbitrary hostnames', () => {
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
  });
});

describe('cleanupServiceWorker', () => {
  function makeFakeNavigator(regs: ServiceWorkerRegistration[]): Navigator {
    return {
      serviceWorker: {
        getRegistrations: vi.fn(async () => regs),
      },
    } as unknown as Navigator;
  }

  function makeFakeRegistration(): ServiceWorkerRegistration {
    return { unregister: vi.fn(async () => true) } as unknown as ServiceWorkerRegistration;
  }

  function makeFakeCaches(names: string[]): CacheStorage {
    return {
      keys: vi.fn(async () => names),
      delete: vi.fn(async () => true),
    } as unknown as CacheStorage;
  }

  it('unregisters every existing service worker registration', async () => {
    const reg1 = makeFakeRegistration();
    const reg2 = makeFakeRegistration();
    const nav = makeFakeNavigator([reg1, reg2]);
    await cleanupServiceWorker({ navigator: nav, cacheStorage: makeFakeCaches([]) });
    expect(reg1.unregister).toHaveBeenCalledOnce();
    expect(reg2.unregister).toHaveBeenCalledOnce();
  });

  it('deletes every cache returned by caches.keys()', async () => {
    const cacheStorage = makeFakeCaches(['workbox-precache-v2-foo', 'navigations', 'pyodide-cdn']);
    await cleanupServiceWorker({ navigator: makeFakeNavigator([]), cacheStorage });
    expect(cacheStorage.delete).toHaveBeenCalledWith('workbox-precache-v2-foo');
    expect(cacheStorage.delete).toHaveBeenCalledWith('navigations');
    expect(cacheStorage.delete).toHaveBeenCalledWith('pyodide-cdn');
  });

  it('does not throw if getRegistrations rejects', async () => {
    const nav = {
      serviceWorker: { getRegistrations: vi.fn(async () => { throw new Error('boom'); }) },
    } as unknown as Navigator;
    await expect(cleanupServiceWorker({ navigator: nav, cacheStorage: makeFakeCaches([]) }))
      .resolves.toBeUndefined();
  });

  it('does not throw if caches API is absent', async () => {
    await expect(cleanupServiceWorker({ navigator: makeFakeNavigator([]), cacheStorage: undefined }))
      .resolves.toBeUndefined();
  });

  it('does not throw if navigator.serviceWorker is absent', async () => {
    const nav = {} as unknown as Navigator;
    await expect(cleanupServiceWorker({ navigator: nav, cacheStorage: makeFakeCaches([]) }))
      .resolves.toBeUndefined();
  });
});

describe('handleRegistration', () => {
  it('sends skipWaiting to a worker that is already waiting at registration time', () => {
    const waiting = makeWorker('installed');
    const reg = makeRegistration({ waiting });
    handleRegistration(reg);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('sends skipWaiting when a newly installing worker transitions to installed with an active controller', () => {
    const installing = makeWorker('installing');
    const reg = makeRegistration({ installing });
    handleRegistration(reg, { hasController: true });

    (installing as unknown as { state: ServiceWorker['state'] }).state = 'installed';
    (installing as unknown as { dispatch(e: string): void }).dispatch('statechange');

    expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('does NOT skipWaiting on first-ever install (no existing controller)', () => {
    const installing = makeWorker('installing');
    const reg = makeRegistration({ installing });
    handleRegistration(reg, { hasController: false });

    (installing as unknown as { state: ServiceWorker['state'] }).state = 'installed';
    (installing as unknown as { dispatch(e: string): void }).dispatch('statechange');

    expect(installing.postMessage).not.toHaveBeenCalled();
  });

  it('attaches an updatefound listener and handles late-arriving installing workers', () => {
    const reg = makeRegistration({});
    handleRegistration(reg, { hasController: true });
    expect(reg.addEventListener).toHaveBeenCalledWith('updatefound', expect.any(Function));

    const installing = makeWorker('installing');
    (reg as unknown as { installing: ServiceWorker | null }).installing = installing;
    (reg as unknown as { dispatch(e: string): void }).dispatch('updatefound');

    (installing as unknown as { state: ServiceWorker['state'] }).state = 'installed';
    (installing as unknown as { dispatch(e: string): void }).dispatch('statechange');

    expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});
