// Layered backend dispatcher for image fetching. Detects which backends are
// available and exposes fetchImage(url), which picks the highest-priority
// backend and delegates.
//
// Priority: helper > user-worker. The operator-hosted proxy is not yet
// implemented; it will be added in a later plan once the deployment story is
// settled.

import { probeConfiguredHelper, fetchImageViaHelper } from './helper-client';
import { loadProxyConfig, type ProxyConfig } from './proxy-config';
import { fetchImageViaUserWorker } from './user-worker-client';
import { config } from './config';

export type BackendKind = 'helper' | 'user-worker';

export interface HelperBackend {
  readonly kind: 'helper';
  readonly version: string;
  readonly features: readonly string[];
}

export interface UserWorkerBackend {
  readonly kind: 'user-worker';
  readonly config: ProxyConfig;
}

export type Backend = HelperBackend | UserWorkerBackend;

export class NoBackendsAvailableError extends Error {
  constructor() {
    super('No image-fetching backend is available.');
    this.name = 'NoBackendsAvailableError';
  }
}

/**
 * Detect which backends are currently usable. Returns them in priority order
 * (most preferred first). Probes are run in parallel.
 */
export async function detectBackends(): Promise<Backend[]> {
  const [helperStatus, proxyCfg] = await Promise.all([
    probeConfiguredHelper(),
    loadProxyConfig(),
  ]);

  const out: Backend[] = [];
  if (helperStatus.status === 'available') {
    out.push({
      kind: 'helper',
      version: helperStatus.version,
      features: helperStatus.features,
    });
  }
  if (proxyCfg !== null && proxyCfg.url !== '' && proxyCfg.sharedSecret !== '') {
    out.push({ kind: 'user-worker', config: proxyCfg });
  }
  return out;
}

/**
 * Fetch a single image via the highest-priority available backend. Throws
 * `NoBackendsAvailableError` if no backend is configured. Throws the backend's
 * own error if the chosen backend fails (no automatic failover — the caller
 * decides whether to retry).
 */
export async function fetchImage(imageUrl: string): Promise<Blob> {
  const backends = await detectBackends();
  if (backends.length === 0) throw new NoBackendsAvailableError();
  const backend = backends[0];
  if (backend.kind === 'helper') {
    return fetchImageViaHelper(config.helperOrigin, imageUrl);
  }
  return fetchImageViaUserWorker(backend.config, imageUrl);
}
