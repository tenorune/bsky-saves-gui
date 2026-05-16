// Background loop that walks an inventory's article URLs, extracts each via
// the configured backend, and mutates the inventory in place: writes
// article_text and (when present) article_title onto each save. Persists the
// updated inventory back to IDB once the run completes. Updates
// articleHydration as it goes.
//
// HYDRATION INVARIANT (applies to every hydrator in this app):
//   - Never re-fetch what we already have.
//   - The displayed count must reflect cumulative coverage from frame
//     zero of every run — pre-compute `skipped` BEFORE setting the store,
//     and seed `failures` from the persisted list.
// Implementation: extractArticleUrls returns saves missing article_text;
// the count of already-hydrated saves is `allUrls - urlsToFetch`. The
// store is set with that `skipped` value before the iteration starts.
//
// Articles are stored INSIDE the inventory (not a separate store) to match
// bsky-saves' CLI shape and the existing parser's article synthesis. As a
// consequence, fresh /fetch calls would otherwise wipe article_text on
// every save — `library-refresh.mergeHydratedFields` carries it forward
// across each fetch (see that function for the canonical list of
// local-only annotations).
//
// Routing decision is driven by CapabilitySnapshot.articles (read once per
// hydrateArticles call).

import { get } from 'svelte/store';
import { extractArticleUrls } from './extract-article-urls';
import { extractArticleViaHelper, type ExtractedArticle } from './helper-client';
import { config } from './config';
import { saveInventory } from './inventory-store';
import { loadFromDb } from './inventory-loader';
import { articleHydration, type HydrationFailure, PAIRING_REQUIRED_REASON } from './hydration-state';
import { extractArticleViaWorker } from './user-worker-client';
import { saveFailures, loadFailures } from './failure-store';
import { capabilitySnapshot, type CapabilitySnapshot } from './capability-snapshot';
import { pairingToken } from './pairing-token';

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
    const sharedSecret = backend.sharedSecret;
    return (articleUrl) =>
      extractArticleViaWorker(
        { url: workerUrl, sharedSecret, supportsArticles: true },
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

  // Carry forward any persisted failures whose URL is still relevant
  // (still in the inventory and still needing hydration), so the count
  // doesn't flash back to 0 each refresh.
  const persisted = await loadFailures('articles');
  const carriedFailures = persisted.filter((f) => urlsToFetch.includes(f.url));
  const failures: HydrationFailure[] = [...carriedFailures];
  let failed = failures.length;

  articleHydration.set({
    status: urlsToFetch.length === 0 ? 'done' : 'running',
    // Use the full article-eligible set as `total` so the LibraryHub
    // display ("X of total") reflects cumulative coverage rather than
    // just this run's slice. Images uses the same shape (total = all
    // image URLs, skipped = already-hydrated).
    total: allUrls.length,
    fetched: 0,
    skipped,
    failed,
    failures: [...failures],
  });

  let fetched = 0;

  for (let idx = 0; idx < urlsToFetch.length; idx++) {
    const url = urlsToFetch[idx];
    if (signal?.aborted) {
      articleHydration.update((s) => ({ ...s, status: 'cancelled' }));
      // Persist whatever we did so far AND refresh inventoryState so
      // Library/Post views reflect the partial progress without needing
      // a hard refresh (sibling of issue #15 / PR #20 for threads).
      try {
        await saveInventory(inventory);
        await loadFromDb();
      } catch {
        // best-effort persist + refresh
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
      // If this URL was a carried-forward failure, drop it on success.
      const i = failures.findIndex((f) => f.url === url);
      if (i >= 0) {
        failures.splice(i, 1);
        failed--;
      }
      articleHydration.update((s) => ({
        ...s,
        fetched: s.fetched + 1,
        failed: s.failures.filter((f) => f.url !== url).length,
        failures: s.failures.filter((f) => f.url !== url),
      }));
    } catch (err) {
      // AbortError: the user clicked Stop. Fall through; the next iteration's
      // signal.aborted check will exit cleanly.
      if (err instanceof Error && err.name === 'AbortError') {
        continue;
      }
      const failure: HydrationFailure = { url, reason: reasonOf(err) };
      const i = failures.findIndex((f) => f.url === url);
      if (i >= 0) {
        failures[i] = failure;
      } else {
        failures.push(failure);
        failed++;
      }
      articleHydration.update((s) => {
        const others = s.failures.filter((f) => f.url !== url);
        return {
          ...s,
          failed: others.length + 1,
          failures: [...others, failure],
        };
      });
    }

    // Pairing-stale bail-out (mirrors image-hydrator's check). If a 401
    // from extractArticleViaHelper flipped the pairing store to 'stale',
    // re-tag the just-failed item and the un-attempted items as
    // pairing-required so the Failed-N modal surfaces them under a single
    // clear cause, and exit cleanly. PairingRequiredBanner is already up.
    if (get(pairingToken).state === 'stale') {
      const lastIdx = failures.findIndex((f) => f.url === url);
      if (lastIdx >= 0) {
        failures[lastIdx] = { url, reason: PAIRING_REQUIRED_REASON };
      }
      for (let j = idx + 1; j < urlsToFetch.length; j++) {
        const remainingUrl = urlsToFetch[j];
        const existing = failures.findIndex((f) => f.url === remainingUrl);
        if (existing >= 0) {
          failures[existing] = { url: remainingUrl, reason: PAIRING_REQUIRED_REASON };
        } else {
          failures.push({ url: remainingUrl, reason: PAIRING_REQUIRED_REASON });
        }
      }
      failed = failures.length;
      articleHydration.update((s) => ({
        ...s,
        status: 'cancelled',
        failed,
        failures: [...failures],
      }));
      try {
        await saveInventory(inventory);
        await loadFromDb();
      } catch {
        // best-effort persist + refresh
      }
      void saveFailures('articles', failures);
      return { fetched, skipped, failed, cancelled: true };
    }
  }

  // If the signal fired mid-fetch the AbortError catch above did a `continue`
  // which exits the loop. Detect that and return as cancelled.
  if (signal?.aborted) {
    articleHydration.update((s) => ({ ...s, status: 'cancelled' }));
    try {
      await saveInventory(inventory);
      await loadFromDb();
    } catch {
      // best-effort persist + refresh
    }
    void saveFailures('articles', failures);
    return { fetched, skipped, failed, cancelled: true };
  }

  // Persist the mutated inventory once at the end of the run AND refresh
  // inventoryState so Library/Post views see the new article_text without
  // a hard refresh (sibling of issue #15 / PR #20 for threads).
  try {
    await saveInventory(inventory);
    await loadFromDb();
  } catch {
    // If persistence (or the follow-up reload) fails, the in-memory
    // mutation still benefits the current session for as long as the
    // hydrator's local `inventory` ref is reachable; a future run can
    // re-fetch what didn't land.
  }

  articleHydration.update((s) => ({ ...s, status: 'done' }));
  void saveFailures('articles', failures);
  return { fetched, skipped, failed, cancelled: false };
}
