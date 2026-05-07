export interface WorkerLike {
  postMessage(m: unknown): void;
  addEventListener(type: 'message' | 'error', listener: (e: MessageEvent | ErrorEvent) => void): void;
  removeEventListener(type: 'message' | 'error', listener: (e: MessageEvent | ErrorEvent) => void): void;
  terminate(): void;
}

export interface FetchOnlyInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly preauthSession?: { accessJwt: string; refreshJwt: string; did: string; handle: string };
}

export interface EnrichOnlyInput { readonly inventory: unknown; }

export interface ThreadsOnlyInput {
  readonly inventory: unknown;
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly preauthSession?: { accessJwt: string; refreshJwt: string; did: string; handle: string };
}

export interface SendOptions {
  /**
   * Called with each Python stdout/stderr line streamed from the worker
   * during the call. Used to parse [N/M]-style progress prints from
   * bsky-saves' CLI loops (e.g., hydrate_threads).
   */
  readonly onLog?: (line: string) => void;
}

export class PyodideWorkerDriver {
  private _initPromise: Promise<void> | null = null;

  constructor(private worker: WorkerLike) {}

  initialise(pyodideVersion: string): Promise<void> {
    if (!this._initPromise) {
      this._initPromise = new Promise<void>((resolve, reject) => {
        const onMessage = (e: MessageEvent | ErrorEvent) => {
          if ('data' in e && (e as MessageEvent).data?.type === 'init-ready') {
            this.worker.removeEventListener('message', onMessage);
            this.worker.removeEventListener('error', onMessage);
            resolve();
          } else if ('data' in e && (e as MessageEvent).data?.type === 'error') {
            this.worker.removeEventListener('message', onMessage);
            this.worker.removeEventListener('error', onMessage);
            reject(new Error((e as MessageEvent).data.message ?? 'pyodide worker init error'));
          } else if (!('data' in e)) {
            this.worker.removeEventListener('message', onMessage);
            this.worker.removeEventListener('error', onMessage);
            reject(new Error('pyodide worker init error'));
          }
        };
        this.worker.addEventListener('message', onMessage);
        this.worker.addEventListener('error', onMessage);
        this.worker.postMessage({ type: 'init', pyodideVersion });
      });
    }
    return this._initPromise;
  }

  async runFetchOnly(input: FetchOnlyInput, opts: SendOptions = {}): Promise<unknown> {
    return this.send({ type: 'fetchOnly', input }, opts);
  }

  async runEnrichOnly(input: EnrichOnlyInput, opts: SendOptions = {}): Promise<unknown> {
    return this.send({ type: 'enrichOnly', input }, opts);
  }

  async runThreadsOnly(input: ThreadsOnlyInput, opts: SendOptions = {}): Promise<unknown> {
    return this.send({ type: 'threadsOnly', input }, opts);
  }

  private send(message: unknown, opts: SendOptions): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const onMessage = (e: MessageEvent | ErrorEvent) => {
        if ('data' in e && (e as MessageEvent).data?.type === 'log') {
          opts.onLog?.((e as MessageEvent).data.line ?? '');
          return; // log messages are not terminal
        }
        if ('data' in e && (e as MessageEvent).data?.type === 'result') {
          this.worker.removeEventListener('message', onMessage);
          this.worker.removeEventListener('error', onMessage);
          resolve((e as MessageEvent).data.payload);
        } else if ('data' in e && (e as MessageEvent).data?.type === 'error') {
          this.worker.removeEventListener('message', onMessage);
          this.worker.removeEventListener('error', onMessage);
          const data = (e as MessageEvent).data as { message?: string; name?: string };
          const msg = data.message && data.message.length > 0
            ? data.message
            : 'pyodide worker error';
          const err = new Error(msg);
          if (data.name) err.name = data.name;
          reject(err);
        } else if (!('data' in e)) {
          this.worker.removeEventListener('message', onMessage);
          this.worker.removeEventListener('error', onMessage);
          reject(new Error('pyodide worker error'));
        }
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onMessage);
      this.worker.postMessage(message);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}

let _shared: PyodideWorkerDriver | null = null;

export function getSharedDriver(): PyodideWorkerDriver {
  if (!_shared) {
    const worker = new Worker(
      new URL('../worker/pyodide-worker.ts', import.meta.url),
      { type: 'module' },
    );
    _shared = new PyodideWorkerDriver(worker);
  }
  return _shared;
}

/** For tests only — resets the shared driver. */
export function _resetSharedDriverForTests(): void {
  _shared = null;
}
