import { describe, expect, it } from 'vitest';
import type { WorkerLike } from './pyodide-runner';

interface PostedMessage {
  readonly type: string;
  readonly [extra: string]: unknown;
}

class FakeWorker implements WorkerLike {
  private messageListener: ((e: MessageEvent<unknown>) => void) | null = null;
  public posted: PostedMessage[] = [];

  addEventListener(type: 'message' | 'error', listener: unknown): void {
    if (type === 'message') {
      this.messageListener = listener as (e: MessageEvent<unknown>) => void;
    }
  }

  postMessage(msg: unknown): void {
    const m = msg as PostedMessage;
    this.posted.push(m);
    queueMicrotask(() => this.handle(m));
  }

  terminate(): void {}

  private dispatch(data: unknown): void {
    this.messageListener?.({ data } as MessageEvent<unknown>);
  }

  private handle(msg: PostedMessage): void {
    if (msg.type === 'init') {
      this.dispatch({ type: 'log', line: 'Loading Pyodide…' });
      this.dispatch({ type: 'log', line: 'Installing bsky-saves…' });
      this.dispatch({ type: 'init-ready' });
      return;
    }
    if (msg.type === 'fetch') {
      this.dispatch({ type: 'log', line: 'Fetching saves…' });
      this.dispatch({ type: 'log', line: 'invoking bsky_saves' });
      this.dispatch({ type: 'log', line: 'Done.' });
      this.dispatch({
        type: 'fetch-result',
        inventory: { saves: [{ uri: 'at://x/y/1' }] },
      });
    }
  }
}

class FailingWorker implements WorkerLike {
  private messageListener: ((e: MessageEvent<unknown>) => void) | null = null;

  addEventListener(type: 'message' | 'error', listener: unknown): void {
    if (type === 'message') {
      this.messageListener = listener as (e: MessageEvent<unknown>) => void;
    }
  }

  postMessage(): void {
    queueMicrotask(() => {
      this.messageListener?.({
        data: { type: 'error', message: 'init failed', name: 'PythonError' },
      } as MessageEvent<unknown>);
    });
  }

  terminate(): void {}
}

describe('PyodideRunner', () => {
  it('initialises and fetches via worker messaging, returning the inventory', async () => {
    const fake = new FakeWorker();
    const { PyodideRunner } = await import('./pyodide-runner');
    const runner = new PyodideRunner({ workerFactory: () => fake });

    await runner.initialise();
    const inventory = await runner.runFetch({
      handle: 'alice.bsky.social',
      appPassword: 'pw',
      pds: 'https://bsky.social',
      enrich: true,
      threads: false,
    });

    expect(fake.posted[0]).toMatchObject({ type: 'init' });
    expect(fake.posted[1]).toMatchObject({
      type: 'fetch',
      input: {
        handle: 'alice.bsky.social',
        appPassword: 'pw',
        pds: 'https://bsky.social',
        enrich: true,
      },
    });
    expect(inventory).toEqual({ saves: [{ uri: 'at://x/y/1' }] });
  });

  it('emits log events received from the worker', async () => {
    const fake = new FakeWorker();
    const { PyodideRunner } = await import('./pyodide-runner');
    const runner = new PyodideRunner({ workerFactory: () => fake });

    const events: string[] = [];
    runner.onLog((m) => events.push(m));

    await runner.initialise();
    await runner.runFetch({
      handle: 'a',
      appPassword: 'b',
      pds: 'https://x',
      enrich: false,
      threads: false,
    });

    expect(events).toContain('Loading Pyodide…');
    expect(events).toContain('Fetching saves…');
    expect(events.some((e) => /bsky_saves/.test(e))).toBe(true);
  });

  it('rejects initialisation when the worker reports an error', async () => {
    const fake = new FailingWorker();
    const { PyodideRunner } = await import('./pyodide-runner');
    const runner = new PyodideRunner({ workerFactory: () => fake });
    await expect(runner.initialise()).rejects.toThrow(/init failed/);
  });
});
