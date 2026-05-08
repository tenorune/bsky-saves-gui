// Background loop that walks an inventory's image URLs, fetches each via the
// Plan 3 dispatcher, writes successful blobs to image-store, and reports
// progress through the hydration-state store.
//
// HYDRATION INVARIANT (applies to every hydrator in this app):
//   - Never re-fetch what we already have.
//   - The displayed count must reflect cumulative coverage from frame
//     zero of every run — pre-compute `skipped` BEFORE setting the store,
//     and seed `failures` from the persisted list.
// Implementation: at the top of the run we Promise.all the IDB checks,
// derive the list of URLs needing fetch, set the store to its final
// `skipped`/`failed` values immediately, then iterate only the fetch list.
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
import { saveFailures, loadFailures } from './failure-store';
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
    const sharedSecret = backend.sharedSecret;
    return (imageUrl) =>
      fetchImageViaUserWorker({ url: workerUrl, sharedSecret, supportsArticles: false }, imageUrl);
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

  // Pre-compute already-hydrated count + persisted failures so the row
  // displays the correct cumulative coverage from the very first frame —
  // no climbing from 0 each refresh, no fail count flashing to 0.
  const blobChecks = await Promise.all(urls.map((u) => hasImageBlob(u)));
  const urlsToFetch = urls.filter((_, i) => !blobChecks[i]);
  const skippedAtStart = urls.length - urlsToFetch.length;

  const persisted = await loadFailures('images');
  // Only carry forward failures whose URL is still both in the inventory
  // AND not yet hydrated (a URL that succeeded since the last run shouldn't
  // be in the failures list anymore).
  const carriedFailures = persisted.filter((f) => urlsToFetch.includes(f.url));
  const failures: HydrationFailure[] = [...carriedFailures];

  imageHydration.set({
    status: urls.length === 0 ? 'done' : 'running',
    total: urls.length,
    fetched: 0,
    skipped: skippedAtStart,
    failed: failures.length,
    failures: [...failures],
  });

  let fetched = 0;
  const skipped = skippedAtStart;
  let failed = failures.length;

  for (const url of urlsToFetch) {
    if (signal?.aborted) {
      imageHydration.update((s) => ({ ...s, status: 'cancelled' }));
      void saveFailures('images', failures);
      return { fetched, skipped, failed, cancelled: true };
    }

    try {
      const blob = await fetcher(url);
      await saveImageBlob(url, blob);
      fetched++;
      // If this URL was a carried-forward failure, drop it on success.
      const i = failures.findIndex((f) => f.url === url);
      if (i >= 0) {
        failures.splice(i, 1);
        failed--;
      }
      imageHydration.update((s) => ({
        ...s,
        fetched: s.fetched + 1,
        failed: s.failures.filter((f) => f.url !== url).length,
        failures: s.failures.filter((f) => f.url !== url),
      }));
    } catch (err) {
      const failure: HydrationFailure = { url, reason: reasonOf(err) };
      const i = failures.findIndex((f) => f.url === url);
      if (i >= 0) {
        // Refresh the reason on a re-failed URL.
        failures[i] = failure;
      } else {
        failures.push(failure);
        failed++;
      }
      imageHydration.update((s) => {
        const others = s.failures.filter((f) => f.url !== url);
        return {
          ...s,
          failed: others.length + 1,
          failures: [...others, failure],
        };
      });
    }
  }

  imageHydration.update((s) => ({ ...s, status: 'done' }));
  void saveFailures('images', failures);
  return { fetched, skipped, failed, cancelled: false };
}
