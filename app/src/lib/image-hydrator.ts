// Background loop that walks an inventory's image URLs, fetches each via the
// Plan 3 dispatcher, writes successful blobs to image-store, and reports
// progress through the hydration-state store.
//
// Designed for foreground-friendly background execution: each await on the
// fetcher yields control to the event loop, so the rest of the app stays
// responsive while hydration runs. AbortSignal allows clean cancellation
// between iterations; in-flight fetches finish but the loop exits afterwards.

import { extractImageUrls } from './extract-image-urls';
import { hasImageBlob, saveImageBlob } from './image-store';
import { fetchImage as defaultFetchImage } from './image-fetcher';
import { imageHydration, type HydrationFailure } from './hydration-state';
import { saveFailures } from './failure-store';

export interface HydrateResult {
  readonly fetched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

export interface HydrateOptions {
  /** Inject a fetcher for testing. Defaults to the real layered dispatcher. */
  readonly fetcher?: (url: string) => Promise<Blob>;
  /** Cancel the loop cleanly between iterations. */
  readonly signal?: AbortSignal;
}

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function hydrateImages(
  inventory: unknown,
  options: HydrateOptions = {},
): Promise<HydrateResult> {
  const fetcher = options.fetcher ?? defaultFetchImage;
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
