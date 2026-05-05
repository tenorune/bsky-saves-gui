import { extractImageUrls } from './extract-image-urls';
import { extractArticleUrls } from './extract-article-urls';
import { hasImageBlob } from './image-store';
import { imageHydration, articleHydration } from './hydration-state';
import { loadBackupPrefs } from './backup-prefs';

/**
 * On Library mount after a page reload, the hydration stores are reset to
 * their initial idle state. The actual saved data persists (image blobs in
 * IDB, article_text in the inventory itself), so for domains the user has
 * already opted into we reconstruct per-asset counts and set the stores to
 * a 'done'-with-counts state. Domains the user hasn't yet triggered stay
 * idle so the discovery banner can still show. Failures are not persisted,
 * so the failures arrays remain empty after restore.
 */
export async function restoreHydrationFromInventory(
  inventory: unknown,
): Promise<void> {
  const prefs = await loadBackupPrefs();

  // Images: only restore when the user has opted into image backup at least
  // once. Otherwise leave the store at idle so the discovery banner shows.
  if (prefs.images.enabled) {
    const imageUrls = extractImageUrls(inventory);
    if (imageUrls.length > 0) {
      let fetched = 0;
      await Promise.all(
        imageUrls.map(async (url) => {
          if (await hasImageBlob(url)) fetched++;
        }),
      );
      imageHydration.set({
        status: 'done',
        total: imageUrls.length,
        fetched,
        skipped: 0,
        failed: 0,
        failures: [],
      });
    }
  }

  // Articles: only restore when the user has opted into article backup.
  if (prefs.articles.enabled) {
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
      articleHydration.set({
        status: 'done',
        total: articleTotal,
        fetched: articleFetched,
        skipped: 0,
        failed: 0,
        failures: [],
      });
    }
  }

  // Reference extractArticleUrls so future refactors notice it; intentional no-op.
  void extractArticleUrls;
}
