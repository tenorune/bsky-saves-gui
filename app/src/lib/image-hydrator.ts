// Background loop that walks an inventory's image URLs, fetches each via the
// Plan 3 dispatcher, writes successful blobs to image-store, and reports
// progress through the hydration-state store.
//
// Designed for foreground-friendly background execution: each await on the
// fetcher yields control to the event loop, so the rest of the app stays
// responsive while hydration runs. AbortSignal allows clean cancellation
// between iterations; in-flight fetches finish but the loop exits afterwards.
//
// Routing decision is driven by CapabilitySnapshot.images (read once per
// hydrateImages call) rather than computed per-URL via detectBackends().

import { get } from 'svelte/store';
import { extractImageUrls } from './extract-image-urls';
import { hasImageBlob, saveImageBlob } from './image-store';
import { imageHydration, type HydrationFailure } from './hydration-state';
import { saveFailures } from './failure-store';
import { capabilitySnapshot, type CapabilitySnapshot } from './capability-snapshot';
import { fetchImageViaHelper } from './helper-client';
import { fetchImageViaUserWorker } from './user-worker-client';
import { config } from './config';

export interface HydrateResult {
  readonly fetched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

export interface HydrateOptions {
  /**
   * Inject a fetcher directly. When provided, snapshot-based routing is
   * bypassed entirely. Useful for existing tests that don't need to exercise
   * routing dispatch.
   */
  readonly fetcher?: (url: string) => Promise<Blob>;
  /** Cancel the loop cleanly between iterations. */
  readonly signal?: AbortSignal;
  /**
   * Provide a CapabilitySnapshot to route image fetches. When omitted and
   * `fetcher` is also omitted, the singleton capabilitySnapshot store is read.
   * Inject a fake in tests to exercise snapshot-based routing.
   */
  readonly getSnapshot?: () => CapabilitySnapshot;
}

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Build a fetcher function from a CapabilitySnapshot's images descriptor.
 *
 * - 'helper'          → fetchImageViaHelper using the configured helper origin
 * - 'user-worker'     → fetchImageViaUserWorker at the snapshot-provided URL
 * - 'operator-worker' → fetchImageViaUserWorker at the operator-configured URL
 */
function fetcherFromSnapshot(snapshot: CapabilitySnapshot): (url: string) => Promise<Blob> {
  const backend = snapshot.images;
  if (backend.kind === 'helper') {
    return (imageUrl) => fetchImageViaHelper(config.helperOrigin, imageUrl);
  }
  if (backend.kind === 'user-worker') {
    const workerUrl = backend.url;
    return (imageUrl) =>
      fetchImageViaUserWorker({ url: workerUrl, sharedSecret: config.operatorImageProxySecret, supportsArticles: false }, imageUrl);
  }
  // operator-worker: use build-time-configured operator proxy credentials
  return (imageUrl) =>
    fetchImageViaUserWorker(
      {
        url: config.operatorImageProxyUrl,
        sharedSecret: config.operatorImageProxySecret,
        supportsArticles: false,
      },
      imageUrl,
    );
}

export async function hydrateImages(
  inventory: unknown,
  options: HydrateOptions = {},
): Promise<HydrateResult> {
  let fetcher: (url: string) => Promise<Blob>;
  if (options.fetcher) {
    fetcher = options.fetcher;
  } else {
    const snapshot = (options.getSnapshot ?? (() => get(capabilitySnapshot)))();
    fetcher = fetcherFromSnapshot(snapshot);
  }
  const signal = options.signal;

  const urls = extractImageUrls(inventory);

  imageHydration.set({
    status: urls.length === 0 ? 'done' : 'running',
    total: urls.length,
    fetched: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  });

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  const failures: HydrationFailure[] = [];

  for (const url of urls) {
    if (signal?.aborted) {
      imageHydration.update((s) => ({ ...s, status: 'cancelled' }));
      void saveFailures('images', failures);
      return { fetched, skipped, failed, cancelled: true };
    }

    if (await hasImageBlob(url)) {
      skipped++;
      imageHydration.update((s) => ({ ...s, skipped: s.skipped + 1 }));
      continue;
    }

    try {
      const blob = await fetcher(url);
      await saveImageBlob(url, blob);
      fetched++;
      imageHydration.update((s) => ({ ...s, fetched: s.fetched + 1 }));
    } catch (err) {
      const failure: HydrationFailure = { url, reason: reasonOf(err) };
      failures.push(failure);
      failed++;
      imageHydration.update((s) => ({
        ...s,
        failed: s.failed + 1,
        failures: [...s.failures, failure],
      }));
    }
  }

  imageHydration.update((s) => ({ ...s, status: 'done' }));
  void saveFailures('images', failures);
  return { fetched, skipped, failed, cancelled: false };
}
