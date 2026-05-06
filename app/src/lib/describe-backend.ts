// Short human-readable descriptions of the backend that WOULD be used for
// image / article backup, given current detection. Used by Settings labels
// and banner subtitles to make the layered backend strategy transparent
// before the user clicks "Save my own copy".

import { detectBackends } from './image-fetcher';
import { probeConfiguredHelper } from './helper-client';
import { loadProxyConfig } from './proxy-config';
import { isHelperOutdated, MIN_HELPER_VERSION } from './min-helper-version';

function describeHelper(version: string): string {
  const base = `the local helper (bsky-saves ${version})`;
  if (isHelperOutdated(version)) {
    return `${base} — outdated, please upgrade to ${MIN_HELPER_VERSION}+`;
  }
  return base;
}

/**
 * Returns a description of the highest-priority available image backend, or
 * `null` if none is available. The description is suitable for inline UI
 * copy ("not yet enabled — would use [description]").
 */
export async function describeAvailableImageBackend(): Promise<string | null> {
  const backends = await detectBackends();
  if (backends.length === 0) return null;
  const b = backends[0];
  if (b.kind === 'helper') return describeHelper(b.version);
  if (b.kind === 'user-worker') return 'your custom Cloudflare Worker';
  if (b.kind === 'operator-proxy') return "the operator's image proxy";
  return null;
}

export interface ArticleBackendStatus {
  readonly available: boolean;
  readonly description: string;
}

/**
 * Returns whether article backup is currently possible (the local helper is
 * running and advertises `extract-article`) plus a short description of the
 * status. Articles are helper-only; user-worker and operator-proxy backends
 * don't run trafilatura.
 */
export async function describeArticleBackend(): Promise<ArticleBackendStatus> {
  const status = await probeConfiguredHelper();
  if (status.status === 'available') {
    if (!status.features.includes('extract-article')) {
      return {
        available: false,
        description: `local helper (bsky-saves ${status.version}) does not advertise article extraction`,
      };
    }
    return {
      available: true,
      description: describeHelper(status.version),
    };
  }

  // Helper absent — fall back to user worker if it supports articles.
  const proxy = await loadProxyConfig();
  if (proxy && proxy.supportsArticles) {
    return { available: true, description: 'your custom Cloudflare Worker' };
  }

  return { available: false, description: 'the local helper is not running' };
}
