// Thin client that drives the Pyodide Web Worker. All Pyodide state lives in
// the worker; this file just sends typed messages and resolves promises when
// the worker replies.
//
// bsky-saves entry point findings (2026-05-01):
//   - Package: bsky_saves (pip: bsky-saves)
//   - Programmatic fetch: bsky_saves.fetch.fetch_to_inventory(Path, handle=, app_password=, pds_base=)
//   - Programmatic enrich: bsky_saves.enrich.enrich_inventory(Path)
//   - Inventory file: saves_inventory.json in cwd (default /home/pyodide)
//   - Env vars: BSKY_HANDLE, BSKY_APP_PASSWORD, BSKY_PDS

import { config } from './config';

export interface FetchInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly enrich: boolean;
  /**
   * Optional pre-authenticated session from the JS-side AT Proto login.
   * If provided, the worker monkey-patches bsky_saves.auth.create_session to
   * return this dict instead of POSTing to the PDS again. This avoids a known
   * issue where some PDSs (e.g. eurosky.social) hang the worker's sync XHR
   * createSession even though browser fetch to the same endpoint succeeds.
   */
  readonly preauthSession?: {
    readonly accessJwt: string;
    readonly refreshJwt: string;
    readonly did: string;
    readonly handle: string;
  };
}

type LogListener = (message: string) => void;

interface InitReadyMessage {
  readonly type: 'init-ready';
}
interface LogMessage {
  readonly type: 'log';
  readonly line: string;
}
interface FetchResultMessage {
  readonly type: 'fetch-result';
  readonly inventory: unknown;
}
interface ErrorMessage {
  readonly type: 'error';
  readonly message: string;
  readonly name: string;
}
type Outbound = InitReadyMessage | LogMessage | FetchResultMessage | ErrorMessage;

export interface WorkerLike {
  postMessage(msg: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<Outbound>) => void): void;
  addEventListener(type: 'error', listener: (e: ErrorEvent) => void): void;
  terminate(): void;
}

export interface PyodideRunnerOptions {
  readonly workerFactory?: () => WorkerLike;
}

function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL('../worker/pyodide-worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

export class PyodideRunner {
  private worker: WorkerLike | null = null;
  private logListeners: LogListener[] = [];
  private pending: {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
  } | null = null;
  private readonly workerFactory: () => WorkerLike;

  constructor(options: PyodideRunnerOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.push(listener);
    return () => {
      this.logListeners = this.logListeners.filter((l) => l !== listener);
    };
  }

  private emitLog(message: string): void {
    for (const l of this.logListeners) l(message);
  }

  private handleMessage(event: MessageEvent<Outbound>): void {
    const msg = event.data;
    if (msg.type === 'log') {
      this.emitLog(msg.line);
      return;
    }
    if (msg.type === 'init-ready') {
      this.pending?.resolve(undefined);
      this.pending = null;
      return;
    }
    if (msg.type === 'fetch-result') {
      this.pending?.resolve(msg.inventory);
      this.pending = null;
      return;
    }
    if (msg.type === 'error') {
      const err = new Error(msg.message);
      err.name = msg.name;
      this.pending?.reject(err);
      this.pending = null;
      return;
    }
  }

  private handleError(event: ErrorEvent): void {
    // ErrorEvent fields are commonly empty when the failure is at the worker
    // load/parse stage rather than at runtime. Surface every detail we have
    // and route the raw event to the browser console for inspection.
    // eslint-disable-next-line no-console
    console.error('[pyodide-runner] worker error event:', event);
    const parts = [
      event.message,
      event.filename ? `at ${event.filename}` : '',
      event.lineno ? `line ${event.lineno}:${event.colno}` : '',
    ].filter(Boolean);
    const err = new Error(
      parts.length > 0
        ? `Worker error: ${parts.join(' ')}`
        : 'Worker failed to start (see browser console for details)',
    );
    this.pending?.reject(err);
    this.pending = null;
  }

  async initialise(): Promise<void> {
    if (this.worker) return;
    const worker = this.workerFactory();
    worker.addEventListener('message', (e: MessageEvent<Outbound>) => this.handleMessage(e));
    worker.addEventListener('error', (e: ErrorEvent) => this.handleError(e));
    this.worker = worker;
    return new Promise<void>((resolve, reject) => {
      this.pending = {
        resolve: () => resolve(),
        reject,
      };
      worker.postMessage({ type: 'init', pyodideVersion: config.pyodideVersion });
    });
  }

  async runFetch(input: FetchInput): Promise<unknown> {
    if (!this.worker) throw new Error('Runner not initialised');
    const worker = this.worker;
    return new Promise<unknown>((resolve, reject) => {
      this.pending = { resolve, reject };
      worker.postMessage({ type: 'fetch', input });
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
  }
}
