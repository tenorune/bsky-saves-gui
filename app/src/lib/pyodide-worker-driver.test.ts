import { describe, expect, it } from 'vitest';
import { PyodideWorkerDriver, type WorkerLike } from './pyodide-worker-driver';

class FakeWorker implements WorkerLike {
  posted: unknown[] = [];
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  postMessage(m: unknown): void {
    this.posted.push(m);
    queueMicrotask(() => {
      const ls = this.listeners.get('message') ?? [];
      ls.forEach((l) => l(new MessageEvent('message', { data: { type: 'result', payload: { saves: [] } } })));
    });
  }
  addEventListener(type: string, listener: (e: MessageEvent) => void): void {
    const ls = this.listeners.get(type) ?? [];
    ls.push(listener);
    this.listeners.set(type, ls);
  }
  removeEventListener(): void { /* noop */ }
  terminate(): void { /* noop */ }
}

/** Variant of FakeWorker that replies to 'init' with 'init-ready', and to other messages with 'result'. */
class FakeWorkerWithInit implements WorkerLike {
  posted: unknown[] = [];
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  postMessage(m: unknown): void {
    this.posted.push(m);
    const msg = m as { type?: string };
    queueMicrotask(() => {
      const ls = this.listeners.get('message') ?? [];
      if (msg.type === 'init') {
        ls.forEach((l) => l(new MessageEvent('message', { data: { type: 'init-ready' } })));
      } else {
        ls.forEach((l) => l(new MessageEvent('message', { data: { type: 'result', payload: { saves: [] } } })));
      }
    });
  }
  addEventListener(type: string, listener: (e: MessageEvent) => void): void {
    const ls = this.listeners.get(type) ?? [];
    ls.push(listener);
    this.listeners.set(type, ls);
  }
  removeEventListener(): void { /* noop */ }
  terminate(): void { /* noop */ }
}

describe('PyodideWorkerDriver', () => {
  it('runFetchOnly posts the right message and resolves with the result', async () => {
    const fake = new FakeWorker();
    const drv = new PyodideWorkerDriver(fake);
    const out = await drv.runFetchOnly({
      handle: 'a', appPassword: 'b', pds: 'c',
    });
    expect(fake.posted[0]).toEqual({
      type: 'fetchOnly',
      input: { handle: 'a', appPassword: 'b', pds: 'c' },
    });
    expect(out).toEqual({ saves: [] });
  });

  it('initialise() sends {type: init} and resolves when worker replies init-ready', async () => {
    const fake = new FakeWorkerWithInit();
    const drv = new PyodideWorkerDriver(fake);

    await drv.initialise('0.27.0');

    expect(fake.posted[0]).toEqual({ type: 'init', pyodideVersion: '0.27.0' });
  });

  it('initialise() is idempotent — only sends init once on repeated calls', async () => {
    const fake = new FakeWorkerWithInit();
    const drv = new PyodideWorkerDriver(fake);

    await drv.initialise('0.27.0');
    await drv.initialise('0.27.0');

    const initMessages = fake.posted.filter((m) => (m as { type?: string }).type === 'init');
    expect(initMessages).toHaveLength(1);
  });
});
