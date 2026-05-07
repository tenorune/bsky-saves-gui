import type { HelperStatus } from './helper-client';

export type HelperFacts =
  | { readonly detected: false }
  | {
      readonly detected: true;
      readonly version: string;
      readonly features: readonly string[];
    };

export type CapabilitySnapshot = {
  readonly helper: HelperFacts;
  readonly fetch:    { readonly kind: 'helper' } | { readonly kind: 'pyodide' };
  readonly enrich:   { readonly kind: 'helper' } | { readonly kind: 'pyodide' };
  readonly threads:  { readonly kind: 'helper' } | { readonly kind: 'pyodide' };
  readonly images:
    | { readonly kind: 'helper' }
    | { readonly kind: 'user-worker'; readonly url: string }
    | { readonly kind: 'operator-worker' };
  readonly articles:
    | { readonly kind: 'helper' }
    | { readonly kind: 'user-worker'; readonly url: string }
    | { readonly kind: 'none' };
};

export const EMPTY_SNAPSHOT: CapabilitySnapshot = {
  helper: { detected: false },
  fetch:    { kind: 'pyodide' },
  enrich:   { kind: 'pyodide' },
  threads:  { kind: 'pyodide' },
  images:   { kind: 'operator-worker' },
  articles: { kind: 'none' },
};

export interface CapabilitySnapshotInputs {
  readonly helper: HelperStatus;
  readonly userWorker: { readonly url: string } | null;
}

export function computeCapabilitySnapshot(
  inputs: CapabilitySnapshotInputs,
): CapabilitySnapshot {
  const { helper, userWorker } = inputs;
  if (helper.status !== 'available') {
    return {
      ...EMPTY_SNAPSHOT,
      images:   userWorker ? { kind: 'user-worker', url: userWorker.url } : { kind: 'operator-worker' },
      articles: userWorker ? { kind: 'user-worker', url: userWorker.url } : { kind: 'none' },
    };
  }
  const f = new Set(helper.features);
  const fetchOk = f.has('fetch') && f.has('enrich') && f.has('hydrate-threads') && f.has('jwt-credentials');
  return {
    helper: { detected: true, version: helper.version, features: helper.features },
    fetch:   fetchOk ? { kind: 'helper' } : { kind: 'pyodide' },
    enrich:  fetchOk ? { kind: 'helper' } : { kind: 'pyodide' },
    threads: fetchOk ? { kind: 'helper' } : { kind: 'pyodide' },
    images:
      f.has('fetch-image') ? { kind: 'helper' }
      : userWorker        ? { kind: 'user-worker', url: userWorker.url }
      : { kind: 'operator-worker' },
    articles:
      f.has('extract-article') ? { kind: 'helper' }
      : userWorker             ? { kind: 'user-worker', url: userWorker.url }
      : { kind: 'none' },
  };
}
