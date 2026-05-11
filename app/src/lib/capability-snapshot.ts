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
    | { readonly kind: 'user-worker'; readonly url: string; readonly sharedSecret: string }
    | { readonly kind: 'operator-worker' }
    | { readonly kind: 'none' };
  readonly articles:
    | { readonly kind: 'helper' }
    | { readonly kind: 'user-worker'; readonly url: string; readonly sharedSecret: string }
    | { readonly kind: 'none' };
  /**
   * False until initCapabilitySnapshot has populated the store with real
   * probe results. Consumers (LibraryStatusPanel, etc.) should treat
   * !loaded as "don't render yet" rather than rendering with the
   * EMPTY_SNAPSHOT defaults — otherwise the wrong backend label flashes
   * on screen for the ~100–300ms it takes the helper probe to resolve.
   */
  readonly loaded: boolean;
};

export const EMPTY_SNAPSHOT: CapabilitySnapshot = {
  helper: { detected: false },
  fetch:    { kind: 'pyodide' },
  enrich:   { kind: 'pyodide' },
  threads:  { kind: 'pyodide' },
  images:   { kind: 'operator-worker' },
  articles: { kind: 'none' },
  loaded: false,
};

export interface CapabilitySnapshotInputs {
  readonly helper: HelperStatus;
  readonly userWorker: { readonly url: string; readonly sharedSecret: string } | null;
  readonly operatorProxyOptOut: boolean;
}

export function computeCapabilitySnapshot(
  inputs: CapabilitySnapshotInputs,
): CapabilitySnapshot {
  const { helper, userWorker, operatorProxyOptOut } = inputs;
  const operatorOrNone = operatorProxyOptOut
    ? { kind: 'none' as const }
    : { kind: 'operator-worker' as const };
  const userWorkerVariant = userWorker
    ? { kind: 'user-worker' as const, url: userWorker.url, sharedSecret: userWorker.sharedSecret }
    : null;
  if (helper.status !== 'available') {
    return {
      ...EMPTY_SNAPSHOT,
      images:   userWorkerVariant ?? operatorOrNone,
      articles: userWorkerVariant ?? { kind: 'none' },
      loaded: true,
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
      : userWorkerVariant ?? operatorOrNone,
    articles:
      f.has('extract-article') ? { kind: 'helper' }
      : userWorkerVariant ?? { kind: 'none' },
    loaded: true,
  };
}

import { writable, type Readable } from 'svelte/store';
import { probeConfiguredHelper } from './helper-client';
import { loadProxyConfig } from './proxy-config';
import { loadOperatorProxyOptOut } from './operator-proxy-opt-out';

const store = writable<CapabilitySnapshot>(EMPTY_SNAPSHOT);
export const capabilitySnapshot: Readable<CapabilitySnapshot> = { subscribe: store.subscribe };

export interface InitDeps {
  readonly probe?: () => Promise<HelperStatus>;
  readonly loadUserWorker?: () => Promise<{ readonly url: string; readonly sharedSecret: string } | null>;
  readonly loadOperatorProxyOptOut?: () => Promise<boolean>;
}

export async function initCapabilitySnapshot(deps: InitDeps = {}): Promise<void> {
  const probe = deps.probe ?? probeConfiguredHelper;
  const loadUserWorker = deps.loadUserWorker ?? loadUserWorkerFromProxyConfig;
  const loadOperatorOptOut = deps.loadOperatorProxyOptOut ?? loadOperatorProxyOptOut;
  let helper: HelperStatus;
  try {
    helper = await probe();
  } catch {
    helper = { status: 'unavailable' };
  }
  let userWorker: { readonly url: string; readonly sharedSecret: string } | null;
  try {
    userWorker = await loadUserWorker();
  } catch {
    userWorker = null;
  }
  let operatorProxyOptOut = false;
  try {
    operatorProxyOptOut = await loadOperatorOptOut();
  } catch {
    operatorProxyOptOut = false;
  }
  store.set(computeCapabilitySnapshot({ helper, userWorker, operatorProxyOptOut }));
}

async function loadUserWorkerFromProxyConfig(): Promise<{ readonly url: string; readonly sharedSecret: string } | null> {
  const cfg = await loadProxyConfig();
  return cfg && cfg.url ? { url: cfg.url, sharedSecret: cfg.sharedSecret } : null;
}

/** For tests only — resets the store to EMPTY_SNAPSHOT. */
export function _resetForTests(): void {
  store.set(EMPTY_SNAPSHOT);
}
