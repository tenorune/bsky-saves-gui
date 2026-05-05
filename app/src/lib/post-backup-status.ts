import type { Save } from '../reader/inventory-shape';
import type { HydrationProgress } from './hydration-state';

export type AssetState = 'saved' | 'failed' | 'pending';

export interface PostBackupStatus {
  hasAssets: boolean;
  images: {
    total: number;
    saved: number;
    failed: number;
    failureReasons: string[];
  };
  article: null | { state: AssetState; reason?: string };
  hydrating: boolean;
  summary: string;
  anyFailed: boolean;
}

export interface PostBackupStatusInput {
  save: Save;
  imageUrlsInPost: readonly string[];
  articleUrlInPost: string | null;
  savedImageUrls: ReadonlySet<string>;
  imageHydration: HydrationProgress;
  articleHydration: HydrationProgress;
}

function findFailureReason(
  failures: HydrationProgress['failures'],
  url: string,
): string | undefined {
  for (const f of failures) {
    if (f.url === url) return f.reason;
  }
  return undefined;
}

function imagesPart(
  total: number,
  saved: number,
  failed: number,
): string {
  const noun = total === 1 ? 'image' : 'images';
  if (failed > 0) return `${saved} of ${total} ${noun} saved (${failed} failed)`;
  return `${saved} of ${total} ${noun} saved`;
}

function articlePart(article: { state: AssetState }): string {
  if (article.state === 'saved') return 'article saved';
  if (article.state === 'failed') return 'article failed';
  return 'article not backed up yet';
}

export function getPostBackupStatus(
  input: PostBackupStatusInput,
): PostBackupStatus {
  const {
    save,
    imageUrlsInPost,
    articleUrlInPost,
    savedImageUrls,
    imageHydration,
    articleHydration,
  } = input;

  const hasAssets = imageUrlsInPost.length > 0 || articleUrlInPost !== null;

  const images = (() => {
    const total = imageUrlsInPost.length;
    let saved = 0;
    const failureReasons: string[] = [];
    for (const url of imageUrlsInPost) {
      if (savedImageUrls.has(url)) {
        saved++;
        continue;
      }
      const reason = findFailureReason(imageHydration.failures, url);
      if (reason !== undefined) failureReasons.push(reason);
    }
    return { total, saved, failed: failureReasons.length, failureReasons };
  })();

  const article = (() => {
    if (articleUrlInPost === null) return null;
    const articleText = (save as Record<string, unknown>).article_text;
    if (typeof articleText === 'string' && articleText.length > 0) {
      return { state: 'saved' as AssetState };
    }
    const reason = findFailureReason(articleHydration.failures, articleUrlInPost);
    if (reason !== undefined) return { state: 'failed' as AssetState, reason };
    return { state: 'pending' as AssetState };
  })();

  const hydrating =
    imageHydration.status === 'running' || articleHydration.status === 'running';

  const anyFailed =
    images.failed > 0 || (article !== null && article.state === 'failed');

  const summary = (() => {
    if (!hasAssets) return '';

    // An image is "outstanding" if it has not yet been saved or failed.
    const outstandingImages =
      images.total > 0 && images.saved + images.failed < images.total;
    const articlePending = article !== null && article.state === 'pending';
    const allPending =
      (images.total === 0 || outstandingImages) &&
      (article === null || articlePending) &&
      images.saved === 0;

    if (allPending && !hydrating) return 'Not backed up yet.';
    if (hydrating && (outstandingImages || articlePending)) return 'Backing up…';

    const parts: string[] = [];
    if (images.total > 0) {
      parts.push(imagesPart(images.total, images.saved, images.failed));
    }
    if (article !== null) {
      parts.push(articlePart(article));
    }
    const joined = parts.join(' · ') + '.';
    // Sentence-case: capitalize the first character.
    return joined.charAt(0).toUpperCase() + joined.slice(1);
  })();

  return { hasAssets, images, article, hydrating, summary, anyFailed };
}
