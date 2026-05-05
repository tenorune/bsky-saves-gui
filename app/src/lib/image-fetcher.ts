// Layered backend dispatcher for image fetching. Detects which backends are
// available and exposes fetchImage(url), which picks the highest-priority
// backend and delegates.
//
// Priority: helper > user-worker > operator-proxy. The operator-hosted proxy
// is a build-time-configured fallback that uses the same cf-worker template
// as the user-worker, so dispatch goes through the same client.

import { probeConfiguredHelper, fetchImageViaHelper } from './helper-client';
import { loadProxyConfig, type ProxyConfig } from './proxy-config';
import { fetchImageViaUserWorker } from './user-worker-client';
import { config } from './config';
import { loadBackupPrefs } from './backup-prefs';

export type BackendKind = 'helper' | 'user-worker' | 'operator-proxy';

export interface HelperBackend {
  readonly kind: 'helper';
  readonly version: string;
  readonly features: readonly string[];
}

export interface UserWorkerBackend {
  readonly kind: 'user-worker';
  readonly config: ProxyConfig;
}

export interface OperatorProxyBackend {
  readonly kind: 'operator-proxy';
  readonly config: ProxyConfig;
}

export type Backend = HelperBackend | UserWorkerBackend | OperatorProxyBackend;

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
  const [helperStatus, proxyCfg, prefs] = await Promise.all([
    probeConfiguredHelper(),
    loadProxyConfig(),
    loadBackupPrefs(),
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
  if (
    !prefs.operatorProxyOptOut &&
    config.operatorImageProxyUrl !== '' &&
    config.operatorImageProxySecret !== ''
  ) {
    out.push({
      kind: 'operator-proxy',
      config: {
        url: config.operatorImageProxyUrl,
        sharedSecret: config.operatorImageProxySecret,
        supportsArticles: false,
      },
    });
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
  // Both user-worker and operator-proxy use the same cf-worker template's
  // POST /fetch envelope, so we can dispatch through the same client.
  return fetchImageViaUserWorker(backend.config, imageUrl);
}
