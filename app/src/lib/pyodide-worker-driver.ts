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

export class PyodideWorkerDriver {
  constructor(private worker: WorkerLike) {}

  runFetchOnly(input: FetchOnlyInput): Promise<unknown> {
    return this.send({ type: 'fetchOnly', input });
  }

  runEnrichOnly(input: EnrichOnlyInput): Promise<unknown> {
    return this.send({ type: 'enrichOnly', input });
  }

  runThreadsOnly(input: ThreadsOnlyInput): Promise<unknown> {
    return this.send({ type: 'threadsOnly', input });
  }

  private send(message: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const onMessage = (e: MessageEvent | ErrorEvent) => {
        if ('data' in e && (e as MessageEvent).data?.type === 'result') {
          this.worker.removeEventListener('message', onMessage);
          this.worker.removeEventListener('error', onMessage);
          resolve((e as MessageEvent).data.payload);
        } else if ('data' in e && (e as MessageEvent).data?.type === 'error') {
          this.worker.removeEventListener('message', onMessage);
          this.worker.removeEventListener('error', onMessage);
          reject(new Error((e as MessageEvent).data.message ?? 'pyodide worker error'));
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
