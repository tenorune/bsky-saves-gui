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
  private _activeReject: ((e: Error) => void) | null = null;

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
      const cleanup = () => {
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onMessage);
        if (this._activeReject === reject) this._activeReject = null;
      };
      const onMessage = (e: MessageEvent | ErrorEvent) => {
        if ('data' in e && (e as MessageEvent).data?.type === 'log') {
          opts.onLog?.((e as MessageEvent).data.line ?? '');
          return; // log messages are not terminal
        }
        if ('data' in e && (e as MessageEvent).data?.type === 'snapshot') {
          // Snapshot replies have their own listener (see requestSnapshot);
          // don't treat them as terminal here.
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
      this._activeReject = reject;
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onMessage);
      this.worker.postMessage(message);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }

  /**
   * Forcibly stop whatever the worker is currently doing. Terminates the
   * underlying Worker (Pyodide can't be interrupted from outside) and
   * rejects any in-flight send() promise so the caller's catch path runs.
   * The driver is not reusable afterwards — call cancelSharedDriver()
   * which both cancels and clears the singleton so the next consumer
   * spawns a fresh worker.
   */
  cancelActive(): void {
    this.worker.terminate();
    const r = this._activeReject;
    this._activeReject = null;
    if (r) r(new Error('pyodide worker cancelled'));
  }

  /**
   * Ask the worker for the current on-disk inventory. Used by the cancel
   * path of the threads hydrator: bsky-saves >=0.4.2 flushes inventory
   * after each save, so this returns whatever's been completed so far.
   *
   * Default timeout is 35s — the worker's JS event loop is blocked while
   * Python is mid-fetch via the synchronous-XHR shim, so the snapshot-request
   * handler can't run until Python yields between iterations. Typical fetches
   * complete in <2s; bsky-saves' httpx `TIMEOUT = 30.0` is the worst case
   * (plus rate-limit sleep). Resolves with `null` on timeout or if no
   * inventory has been written yet.
   */
  requestSnapshot(timeoutMs = 35000): Promise<unknown | null> {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return new Promise<unknown | null>((resolve) => {
      let settled = false;
      const cleanup = () => {
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onMessage);
        clearTimeout(timer);
      };
      const elapsed = () => Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now())) - t0);
      const onMessage = (e: MessageEvent | ErrorEvent) => {
        if ('data' in e && (e as MessageEvent).data?.type === 'snapshot') {
          if (settled) return;
          settled = true;
          cleanup();
          // eslint-disable-next-line no-console
          console.info(`[pyodide-worker] snapshot received after ${elapsed()}ms`);
          resolve((e as MessageEvent).data.inventory ?? null);
        }
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        // eslint-disable-next-line no-console
        console.warn(`[pyodide-worker] snapshot request timed out after ${elapsed()}ms`);
        resolve(null);
      }, timeoutMs);
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onMessage);
      this.worker.postMessage({ type: 'snapshot-request' });
    });
  }

  /**
   * Snapshot-then-cancel: request the latest inventory snapshot, then
   * terminate the worker. Returns the snapshot (or null on timeout).
   * The driver is not reusable afterwards.
   */
  async requestSnapshotThenCancel(timeoutMs = 35000): Promise<unknown | null> {
    let snapshot: unknown | null = null;
    try {
      snapshot = await this.requestSnapshot(timeoutMs);
    } finally {
      this.cancelActive();
    }
    return snapshot;
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
 * Terminate any in-flight worker operation and clear the shared driver
 * so the next caller spawns a fresh worker. Called when the user cancels
 * an asset hydration that's running on the Pyodide path — there's no
 * cooperative cancellation inside the Python loop, so we kill the
 * worker outright.
 */
export function cancelSharedDriver(): void {
  if (_shared) {
    _shared.cancelActive();
    _shared = null;
  }
}

/**
 * Snapshot-then-cancel: ask the shared driver for its current on-disk
 * inventory snapshot, then terminate. Used by the threads hydrator's
 * cancel path so partial progress (per-iteration flushes from
 * bsky-saves >=0.4.2) is preserved instead of discarded.
 */
export async function snapshotAndCancelSharedDriver(timeoutMs = 35000): Promise<unknown | null> {
  if (!_shared) return null;
  const drv = _shared;
  _shared = null;
  return drv.requestSnapshotThenCancel(timeoutMs);
}

/** For tests only — resets the shared driver. */
export function _resetSharedDriverForTests(): void {
  _shared = null;
}
