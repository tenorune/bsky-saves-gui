import type { HelperStatus } from './helper-client';
import type { PyodideSource } from './pyodide-source';

export type HelperFacts =
  | { readonly detected: false }
  | {
      readonly detected: true;
      readonly version: string;
      readonly features: readonly string[];
      /**
       * Stable compat-band integer-as-string from /ping. Undefined for
       * v0.6.0 helpers that pre-date the field (the GUI ignores absence;
       * the ProtocolMismatchBanner only fires when `protocol` IS reported
       * AND exceeds MAX_KNOWN_PROTOCOL).
       */
      readonly protocol?: string;
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
   * Whether the worker should load Pyodide from the jsdelivr CDN ('cdn')
   * or from a same-origin /pyodide/ path served by the local-served
   * helper ('local'). Resolved once at startup via pyodide-source.ts —
   * see docs/superpowers/specs/2026-05-11-pwa-design.md. Used for UI
   * diagnostics; the worker reads the build flag directly for routing.
   */
  readonly pyodideSource: PyodideSource;
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
  pyodideSource: 'cdn',
  loaded: false,
};

export interface CapabilitySnapshotInputs {
  readonly helper: HelperStatus;
  readonly userWorker: { readonly url: string; readonly sharedSecret: string } | null;
  readonly operatorProxyOptOut: boolean;
  /**
   * When true, the user has opted out of using the local helper from
   * this browser. `helper` is treated as `unavailable` regardless of
   * what was probed — all helper-routed features fall back to non-
   * helper paths. See lib/helper-opt-out.ts.
   */
  readonly helperOptOut: boolean;
  readonly pyodideSource: PyodideSource;
}

export function computeCapabilitySnapshot(
  inputs: CapabilitySnapshotInputs,
): CapabilitySnapshot {
  const { helper, userWorker, operatorProxyOptOut, helperOptOut, pyodideSource } = inputs;
  // User said "don't use this helper from this browser" — collapse the
  // detected-helper case into the same shape as no-helper-detected so
  // every routing decision falls back to non-helper paths.
  const effectiveHelper: HelperStatus = helperOptOut
    ? { status: 'unavailable' as const }
    : helper;
  const operatorOrNone = operatorProxyOptOut
    ? { kind: 'none' as const }
    : { kind: 'operator-worker' as const };
  const userWorkerVariant = userWorker
    ? { kind: 'user-worker' as const, url: userWorker.url, sharedSecret: userWorker.sharedSecret }
    : null;
  if (effectiveHelper.status !== 'available') {
    return {
      ...EMPTY_SNAPSHOT,
      images:   userWorkerVariant ?? operatorOrNone,
      articles: userWorkerVariant ?? { kind: 'none' },
      pyodideSource,
      loaded: true,
    };
  }
  const f = new Set(effectiveHelper.features);
  const fetchOk = f.has('fetch') && f.has('enrich') && f.has('hydrate-threads') && f.has('jwt-credentials');
  return {
    helper: {
      detected: true,
      version: effectiveHelper.version,
      features: effectiveHelper.features,
      ...(effectiveHelper.protocol !== undefined ? { protocol: effectiveHelper.protocol } : {}),
    },
    fetch:   fetchOk ? { kind: 'helper' } : { kind: 'pyodide' },
    enrich:  fetchOk ? { kind: 'helper' } : { kind: 'pyodide' },
    threads: fetchOk ? { kind: 'helper' } : { kind: 'pyodide' },
    images:
      f.has('fetch-image') ? { kind: 'helper' }
      : userWorkerVariant ?? operatorOrNone,
    articles:
      f.has('extract-article') ? { kind: 'helper' }
      : userWorkerVariant ?? { kind: 'none' },
    pyodideSource,
    loaded: true,
  };
}

import { writable, type Readable } from 'svelte/store';
import { probeConfiguredHelper } from './helper-client';
import { loadProxyConfig } from './proxy-config';
import { loadOperatorProxyOptOut } from './operator-proxy-opt-out';
import { loadHelperOptOut } from './helper-opt-out';
import { resolveDefaultPyodideSource } from './pyodide-source';

const store = writable<CapabilitySnapshot>(EMPTY_SNAPSHOT);
export const capabilitySnapshot: Readable<CapabilitySnapshot> = { subscribe: store.subscribe };

export interface InitDeps {
  readonly probe?: () => Promise<HelperStatus>;
  readonly loadUserWorker?: () => Promise<{ readonly url: string; readonly sharedSecret: string } | null>;
  readonly loadOperatorProxyOptOut?: () => Promise<boolean>;
  readonly loadHelperOptOut?: () => Promise<boolean>;
  readonly resolvePyodideSource?: () => Promise<PyodideSource>;
}

export async function initCapabilitySnapshot(deps: InitDeps = {}): Promise<void> {
  const probe = deps.probe ?? probeConfiguredHelper;
  const loadUserWorker = deps.loadUserWorker ?? loadUserWorkerFromProxyConfig;
  const loadOperatorOptOut = deps.loadOperatorProxyOptOut ?? loadOperatorProxyOptOut;
  const loadHelperOpt = deps.loadHelperOptOut ?? loadHelperOptOut;
  const resolveSource = deps.resolvePyodideSource ?? resolveDefaultPyodideSource;

  // Read the helper opt-out FIRST. When the user has opted out, we
  // skip the /ping probe entirely — saves a request and (more
  // importantly) suppresses Safari's unsilenceable mixed-content
  // console error that fires when probing http://localhost from an
  // https origin.
  let helperOptOut = false;
  try {
    helperOptOut = await loadHelperOpt();
  } catch {
    helperOptOut = false;
  }

  let helper: HelperStatus;
  if (helperOptOut) {
    helper = { status: 'unavailable' };
  } else {
    try {
      helper = await probe();
    } catch {
      helper = { status: 'unavailable' };
    }
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
  let pyodideSource: PyodideSource = 'cdn';
  try {
    pyodideSource = await resolveSource();
  } catch {
    pyodideSource = 'cdn';
  }
  store.set(
    computeCapabilitySnapshot({
      helper,
      userWorker,
      operatorProxyOptOut,
      helperOptOut,
      pyodideSource,
    }),
  );
}

async function loadUserWorkerFromProxyConfig(): Promise<{ readonly url: string; readonly sharedSecret: string } | null> {
  const cfg = await loadProxyConfig();
  return cfg && cfg.url ? { url: cfg.url, sharedSecret: cfg.sharedSecret } : null;
}

/** For tests only — resets the store to EMPTY_SNAPSHOT. */
export function _resetForTests(): void {
  store.set(EMPTY_SNAPSHOT);
}
