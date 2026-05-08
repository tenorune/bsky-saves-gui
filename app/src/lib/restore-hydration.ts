import { get } from 'svelte/store';
import { extractImageUrls } from './extract-image-urls';
import { extractArticleUrls } from './extract-article-urls';
import { hasImageBlob } from './image-store';
import { imageHydration, articleHydration, threadProgress } from './hydration-state';
import { loadFailures } from './failure-store';

/**
 * On Library mount after a page reload, the hydration stores are reset to
 * their initial idle state. The actual saved data persists (image blobs in
 * IDB, article_text in the inventory itself), so we reconstruct per-asset
 * counts and set the stores to a 'done'-with-counts state. The Library Hub
 * renders disabled rows with a greyed "X of Y" so the user can see prior
 * coverage even when the toggle is off — meaning the restore must NOT be
 * gated on toggle/prefs state.
 *
 * If the in-memory store already has non-initial state (e.g., the user
 * navigated within the SPA — Library mounted, ran a backup, navigated to
 * Settings, and came back), don't overwrite it: doing so would wipe the
 * accumulated failures list. Skip per-domain.
 *
 * Failures aren't persisted across full page reloads (the in-memory store
 * is the source of truth), so a hard refresh still drops them.
 */
export async function restoreHydrationFromInventory(
  inventory: unknown,
): Promise<void> {
  // Images: restore whenever the in-memory store is at its initial idle
  // state. The toggle/prefs no longer gate restoration — the row UI
  // handles the off-with-counts case itself.
  const currentImage = get(imageHydration);
  const imageStoreIsInitial = currentImage.status === 'idle' && currentImage.total === 0;
  if (imageStoreIsInitial) {
    const imageUrls = extractImageUrls(inventory);
    if (imageUrls.length > 0) {
      let fetched = 0;
      await Promise.all(
        imageUrls.map(async (url) => {
          if (await hasImageBlob(url)) fetched++;
        }),
      );
      const urlSet = new Set(imageUrls);
      const persistedFailures = (await loadFailures('images')).filter((f) => urlSet.has(f.url));
      imageHydration.set({
        status: 'done',
        total: imageUrls.length,
        fetched,
        skipped: 0,
        failed: persistedFailures.length,
        failures: persistedFailures,
      });
    }
  }

  // Articles: same guard.
  const currentArticle = get(articleHydration);
  const articleStoreIsInitial = currentArticle.status === 'idle' && currentArticle.total === 0;
  if (articleStoreIsInitial) {
    let articleTotal = 0;
    let articleFetched = 0;
    if (inventory && typeof inventory === 'object') {
      const inv = inventory as { saves?: unknown };
      if (Array.isArray(inv.saves)) {
        for (const save of inv.saves) {
          if (!save || typeof save !== 'object') continue;
          const s = save as Record<string, unknown>;
          const embed = s.embed;
          if (!embed || typeof embed !== 'object') continue;
          const url = (embed as Record<string, unknown>).url;
          if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
          articleTotal++;
          if (typeof s.article_text === 'string' && s.article_text.length > 0) {
            articleFetched++;
          }
        }
      }
    }
    if (articleTotal > 0) {
      const articleUrlSet = new Set<string>();
      const inv = inventory as { saves?: unknown };
      if (Array.isArray(inv.saves)) {
        for (const save of inv.saves) {
          if (!save || typeof save !== 'object') continue;
          const embed = (save as Record<string, unknown>).embed;
          if (!embed || typeof embed !== 'object') continue;
          const url = (embed as Record<string, unknown>).url;
          if (typeof url === 'string' && /^https?:\/\//.test(url)) articleUrlSet.add(url);
        }
      }
      const persistedFailures = (await loadFailures('articles')).filter((f) => articleUrlSet.has(f.url));
      articleHydration.set({
        status: 'done',
        total: articleTotal,
        fetched: articleFetched,
        skipped: 0,
        failed: persistedFailures.length,
        failures: persistedFailures,
      });
    }
  }

  // Reference extractArticleUrls so future refactors notice it; intentional no-op.
  void extractArticleUrls;

  // Threads: count saves with thread_replies populated as 'fetched',
  // restore the persisted failure list. Same as images/articles —
  // restore whenever the store is initial; the row UI handles off state.
  const currentThread = get(threadProgress);
  const threadStoreIsInitial = currentThread.status === 'idle' && currentThread.total === 0;
  if (threadStoreIsInitial) {
    let threadTotal = 0;
    let threadFetched = 0;
    if (inventory && typeof inventory === 'object') {
      const inv = inventory as { saves?: unknown };
      if (Array.isArray(inv.saves)) {
        for (const save of inv.saves) {
          if (!save || typeof save !== 'object') continue;
          threadTotal++;
          const tr = (save as Record<string, unknown>).thread_replies;
          if (Array.isArray(tr)) threadFetched++;
        }
      }
    }
    if (threadTotal > 0) {
      const persistedFailures = await loadFailures('threads');
      threadProgress.set({
        status: 'done',
        total: threadTotal,
        fetched: threadFetched,
        skipped: 0,
        failed: persistedFailures.length,
        failures: persistedFailures,
      });
    }
  }
}
