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
});
