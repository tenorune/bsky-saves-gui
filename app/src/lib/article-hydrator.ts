// Background loop that walks an inventory's article URLs, extracts each via
// the configured backend, and mutates the inventory in place: writes
// article_text and (when present) article_title onto each save. Persists the
// updated inventory back to IDB once the run completes. Updates
// articleHydration as it goes.
//
// Articles are stored INSIDE the inventory (not a separate store) to match
// bsky-saves' CLI shape and the existing parser's article synthesis.
//
// Routing decision is driven by CapabilitySnapshot.articles (read once per
// hydrateArticles call).

import { get } from 'svelte/store';
import { extractArticleUrls } from './extract-article-urls';
import { extractArticleViaHelper, type ExtractedArticle } from './helper-client';
import { config } from './config';
import { saveInventory } from './inventory-store';
import { articleHydration, type HydrationFailure } from './hydration-state';
import { extractArticleViaWorker } from './user-worker-client';
import { saveFailures } from './failure-store';
import { capabilitySnapshot, type CapabilitySnapshot } from './capability-snapshot';

export interface HydrateArticleResult {
  readonly fetched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

export interface HydrateArticleOptions {
  /**
   * Inject a fetcher directly. When provided, snapshot-based routing is
   * bypassed entirely. Useful for existing tests that don't need to exercise
   * routing dispatch.
   */
  readonly fetcher?: (url: string) => Promise<ExtractedArticle>;
  readonly signal?: AbortSignal;
  /**
   * Provide a CapabilitySnapshot to route article fetches. When omitted and
   * `fetcher` is also omitted, the singleton capabilitySnapshot store is read.
   * Inject a fake in tests to exercise snapshot-based routing.
   */
  readonly getSnapshot?: () => CapabilitySnapshot;
}

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function findSaveByUrl(inventory: unknown, url: string): Record<string, unknown> | null {
  if (!inventory || typeof inventory !== 'object') return null;
  const inv = inventory as { saves?: unknown };
  if (!Array.isArray(inv.saves)) return null;
  for (const save of inv.saves) {
    if (!save || typeof save !== 'object') continue;
    const s = save as Record<string, unknown>;
    const embed = s.embed;
    if (embed && typeof embed === 'object') {
      const e = embed as Record<string, unknown>;
      if (e.url === url) return s;
    }
  }
  return null;
}

/**
 * Build a fetcher function from a CapabilitySnapshot's articles descriptor.
 *
 * - 'helper'      → extractArticleViaHelper using the configured helper origin
 * - 'user-worker' → extractArticleViaWorker at the snapshot-provided URL
 * - 'none'        → throws; the caller records each URL as a failure
 */
function fetcherFromSnapshot(
  snapshot: CapabilitySnapshot,
  signal: AbortSignal | undefined,
): (url: string) => Promise<ExtractedArticle> {
  const backend = snapshot.articles;
  if (backend.kind === 'helper') {
    return (articleUrl) => extractArticleViaHelper(config.helperOrigin, articleUrl, { signal });
  }
  if (backend.kind === 'user-worker') {
    const workerUrl = backend.url;
    return (articleUrl) =>
      extractArticleViaWorker(
        { url: workerUrl, sharedSecret: '', supportsArticles: true },
        articleUrl,
        { signal },
      );
  }
  // kind === 'none'
  return (_articleUrl) => {
    throw new Error('no article backend available — start the local helper or configure a user worker with article support');
  };
}

export async function hydrateArticles(
  inventory: unknown,
  options: HydrateArticleOptions = {},
): Promise<HydrateArticleResult> {
  const signal = options.signal;

  let fetcher: (url: string) => Promise<ExtractedArticle>;
  if (options.fetcher) {
    fetcher = options.fetcher;
  } else {
    const snapshot = (options.getSnapshot ?? (() => get(capabilitySnapshot)))();
    fetcher = fetcherFromSnapshot(snapshot, signal);
  }

  const allUrls: string[] = [];
  if (inventory && typeof inventory === 'object') {
    const inv = inventory as { saves?: unknown };
    if (Array.isArray(inv.saves)) {
      // Count saves with article_text === string AS skipped, but count saves
      // whose embed.url is missing as neither skipped nor fetched.
      for (const save of inv.saves) {
        if (!save || typeof save !== 'object') continue;
        const s = save as Record<string, unknown>;
        const embed = s.embed;
        if (!embed || typeof embed !== 'object') continue;
        const url = (embed as Record<string, unknown>).url;
        if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
        allUrls.push(url);
      }
    }
  }
  const urlsToFetch = extractArticleUrls(inventory);
  const skipped = allUrls.length - urlsToFetch.length;

  articleHydration.set({
    status: urlsToFetch.length === 0 ? 'done' : 'running',
    total: urlsToFetch.length,
    fetched: 0,
    skipped,
    failed: 0,
    failures: [],
  });

  let fetched = 0;
  let failed = 0;
  const failures: HydrationFailure[] = [];

  for (const url of urlsToFetch) {
    if (signal?.aborted) {
      articleHydration.update((s) => ({ ...s, status: 'cancelled' }));
      // Persist whatever we did so far.
      try {
        await saveInventory(inventory);
      } catch {
        // best-effort persist
      }
      void saveFailures('articles', failures);
      return { fetched, skipped, failed, cancelled: true };
    }

    try {
      const result = await fetcher(url);
      const save = findSaveByUrl(inventory, url);
      if (save) {
        save.article_text = result.text;
        if (result.title) save.article_title = result.title;
        save.article = {
          url: result.url,
          text: result.text,
          ...(result.title ? { title: result.title } : {}),
        };
      }
      fetched++;
      articleHydration.update((s) => ({ ...s, fetched: s.fetched + 1 }));
    } catch (err) {
      // AbortError: the user clicked Stop. Fall through; the next iteration's
      // signal.aborted check will exit cleanly.
      if (err instanceof Error && err.name === 'AbortError') {
        continue;
      }
      const failure: HydrationFailure = { url, reason: reasonOf(err) };
      failures.push(failure);
      failed++;
      articleHydration.update((s) => ({
        ...s,
        failed: s.failed + 1,
        failures: [...s.failures, failure],
      }));
    }
  }

  // If the signal fired mid-fetch the AbortError catch above did a `continue`
  // which exits the loop. Detect that and return as cancelled.
  if (signal?.aborted) {
    articleHydration.update((s) => ({ ...s, status: 'cancelled' }));
    try {
      await saveInventory(inventory);
    } catch {
      // best-effort persist
    }
    void saveFailures('articles', failures);
    return { fetched, skipped, failed, cancelled: true };
  }

  // Persist the mutated inventory once at the end of the run.
  try {
    await saveInventory(inventory);
  } catch {
    // If persistence fails, the in-memory mutation still benefits the current
    // session; a future run can re-fetch what didn't land.
  }

  articleHydration.update((s) => ({ ...s, status: 'done' }));
  void saveFailures('articles', failures);
  return { fetched, skipped, failed, cancelled: false };
}
