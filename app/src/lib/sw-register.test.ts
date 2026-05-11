import { describe, it, expect, vi } from 'vitest';
import { handleRegistration } from './sw-register';

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
