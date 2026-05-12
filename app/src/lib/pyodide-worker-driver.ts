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

export interface ThreadsBatchProgress {
  readonly succeeded: number;
  readonly failed: number;
  readonly remaining: number;
}

export interface SendOptions {
  /**
   * Called with each Python stdout/stderr line streamed from the worker
   * during the call. Used to surface bsky-saves' progress prints in the
   * run-page log.
   */
  readonly onLog?: (line: string) => void;
  /**
   * Called after each batch of the JS-driven hydrate_threads loop with the
   * cumulative succeeded/failed counts and the number of items still
   * pending. Only emitted by runThreadsOnly under bsky-saves >=0.4.3.
   */
  readonly onProgress?: (p: ThreadsBatchProgress) => void;
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

  /**
   * Cooperative cancel for an in-flight runThreadsOnly call. The worker
   * sets a flag, which is read between batches in its JS-driven loop; the
   * worker then reads the (per-iteration-flushed) inventory from disk and
   * resolves the in-flight call with that partial inventory as a normal
   * `result`. Cancel latency is bounded by one batch's worth of fetches
   * (typical <2s, worst-case ~30s if a fetch hits bsky-saves' httpx
   * TIMEOUT). The worker is reusable afterwards.
   */
  requestCancel(): void {
    this.worker.postMessage({ type: 'cancel-hydration' });
  }

  private send(message: unknown, opts: SendOptions): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const cleanup = () => {
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onMessage);
      };
      const onMessage = (e: MessageEvent | ErrorEvent) => {
        if ('data' in e && (e as MessageEvent).data?.type === 'log') {
          opts.onLog?.((e as MessageEvent).data.line ?? '');
          return;
        }
        if ('data' in e && (e as MessageEvent).data?.type === 'progress') {
          const data = (e as MessageEvent).data as ThreadsBatchProgress;
          opts.onProgress?.({
            succeeded: data.succeeded,
            failed: data.failed,
            remaining: data.remaining,
          });
          return;
        }
        if ('data' in e && (e as MessageEvent).data?.type === 'result') {
          cleanup();
          resolve((e as MessageEvent).data.payload);
        } else if ('data' in e && (e as MessageEvent).data?.type === 'error') {
          cleanup();
          const data = (e as MessageEvent).data as { message?: string; name?: string };
          const msg = data.message && data.message.length > 0
            ? data.message
            : 'pyodide worker error';
          const err = new Error(msg);
          if (data.name) err.name = data.name;
          reject(err);
        } else if (!('data' in e)) {
          cleanup();
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

/**
 * Send a cooperative cancel to the shared driver's in-flight thread
 * hydration. The worker resolves the in-flight call with its partial
 * inventory; the shared driver remains usable for subsequent runs.
 */
export function requestCancelSharedDriver(): void {
  _shared?.requestCancel();
}

/**
 * Terminate the shared driver and discard the reference so the NEXT call
 * to getSharedDriver() spins up a fresh Pyodide worker with a clean
 * emulated filesystem.
 *
 * This is a privacy boundary, NOT just a memory-management nicety. The
 * Pyodide worker writes the current user's saves to
 * /home/pyodide/saves_inventory.json (see worker/pyodide-worker.ts), and
 * `bsky_saves.fetch.fetch_to_inventory()` merges new fetches into
 * whatever is already at that path. If the worker is reused across
 * sign-ins for different accounts in the same tab session, account B's
 * fetch reads account A's leftover inventory and writes back the merged
 * result — account A's saves end up in account B's Library.
 *
 * Call this from any flow that ends a user's session (Clear data, sign
 * out, "use a different account"). Cost: ~10s Pyodide cold-start on the
 * next fetch. Correctness wins.
 */
export function terminateSharedDriver(): void {
  if (_shared) {
    _shared.terminate();
    _shared = null;
  }
}

/** For tests only — resets the shared driver. */
export function _resetSharedDriverForTests(): void {
  _shared = null;
}
