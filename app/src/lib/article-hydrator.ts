// Background loop that walks an inventory's article URLs, extracts each via
// the helper, and mutates the inventory in place: writes article_text and
// (when present) article_title onto each save. Persists the updated inventory
// back to IDB once the run completes. Updates articleHydration as it goes.
//
// Articles are stored INSIDE the inventory (not a separate store) to match
// bsky-saves' CLI shape and the existing parser's article synthesis.

import { extractArticleUrls } from './extract-article-urls';
import { extractArticleViaHelper, type ExtractedArticle, pingHelper } from './helper-client';
import { config } from './config';
import { saveInventory } from './inventory-store';
import { articleHydration, type HydrationFailure } from './hydration-state';
import { loadProxyConfig, saveProxyConfig } from './proxy-config';
import { extractArticleViaWorker, WorkerNoArticlesError } from './user-worker-client';

function makeDefaultFetcher(): (url: string) => Promise<ExtractedArticle> {
  // Cache the backend choice for the duration of the run. Probe lazily on first
  // call so unit tests that don't actually fetch still see the right shape.
  let resolved: 'helper' | 'worker' | 'none' | undefined;
  let proxy: { url: string; sharedSecret: string; supportsArticles: boolean } | null = null;

  async function resolveBackend() {
    if (resolved !== undefined) return;
    if (await pingHelper(config.helperOrigin)) {
      resolved = 'helper';
      return;
    }
    proxy = await loadProxyConfig();
    if (proxy && proxy.supportsArticles) {
      resolved = 'worker';
      return;
    }
    resolved = 'none';
  }

  return async (url: string) => {
    await resolveBackend();
    if (resolved === 'helper') {
      return extractArticleViaHelper(config.helperOrigin, url);
    }
    if (resolved === 'worker' && proxy) {
      try {
        return await extractArticleViaWorker(proxy, url);
      } catch (err) {
        if (err instanceof WorkerNoArticlesError) {
          await saveProxyConfig({ ...proxy, supportsArticles: false });
          resolved = 'none';
          throw new Error('worker no longer supports articles — redeploy with the article-enabled bundle');
        }
        throw err;
      }
    }
    throw new Error('no article backend available — start the local helper or enable article extraction on your custom worker');
  };
}

export interface HydrateArticleResult {
  readonly fetched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

export interface HydrateArticleOptions {
  /** Inject a fetcher for testing. Defaults to the real helper extractor. */
  readonly fetcher?: (url: string) => Promise<ExtractedArticle>;
  readonly signal?: AbortSignal;
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

export async function hydrateArticles(
  inventory: unknown,
  options: HydrateArticleOptions = {},
): Promise<HydrateArticleResult> {
  const fetcher = options.fetcher ?? makeDefaultFetcher();
  const signal = options.signal;

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

  for (const url of urlsToFetch) {
    if (signal?.aborted) {
      articleHydration.update((s) => ({ ...s, status: 'cancelled' }));
      // Persist whatever we did so far.
      try {
        await saveInventory(inventory);
      } catch {
        // best-effort persist
      }
      return { fetched, skipped, failed, cancelled: true };
    }

    try {
      const result = await fetcher(url);
      const save = findSaveByUrl(inventory, url);
      if (save) {
        save.article_text = result.text;
        if (result.title) save.article_title = result.title;
      }
      fetched++;
      articleHydration.update((s) => ({ ...s, fetched: s.fetched + 1 }));
    } catch (err) {
      const failure: HydrationFailure = { url, reason: reasonOf(err) };
      failed++;
      articleHydration.update((s) => ({
        ...s,
        failed: s.failed + 1,
        failures: [...s.failures, failure],
      }));
    }
  }

  // Persist the mutated inventory once at the end of the run.
  try {
    await saveInventory(inventory);
  } catch {
    // If persistence fails, the in-memory mutation still benefits the current
    // session; a future run can re-fetch what didn't land.
  }

  articleHydration.update((s) => ({ ...s, status: 'done' }));
  return { fetched, skipped, failed, cancelled: false };
}
