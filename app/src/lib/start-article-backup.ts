// Run-lifecycle helper for article backup. Wraps article-hydrator with the
// controls the UI needs:
//
// - startArticleBackup(inventory): probes available backends via
//   initCapabilitySnapshot (with a custom loadUserWorker that only returns the
//   user worker when supportsArticles is true). Reads
//   CapabilitySnapshot.articles to decide whether to start. Returns
//   {started:false, reason} when no backend is available. Otherwise spawns
//   the hydration loop and returns {started:true}.
//
// - cancelArticleBackup(): aborts the most recent run, or no-op.

import { get } from 'svelte/store';
import { hydrateArticles } from './article-hydrator';
import { setBackupEnabled } from './backup-prefs';
import { initCapabilitySnapshot, capabilitySnapshot } from './capability-snapshot';
import { loadProxyConfig } from './proxy-config';

export interface StartArticleResult {
  readonly started: boolean;
  readonly reason?: string;
}

let activeController: AbortController | null = null;

/**
 * Load the user worker URL only if the configured proxy supports article
 * extraction. This prevents routing articles to a worker that doesn't have
 * the `/extract-article` endpoint.
 */
async function loadArticleCapableUserWorker(): Promise<{ readonly url: string } | null> {
  const cfg = await loadProxyConfig();
  return cfg && cfg.url && cfg.supportsArticles ? { url: cfg.url } : null;
}

export async function startArticleBackup(inventory: unknown): Promise<StartArticleResult> {
  await initCapabilitySnapshot({ loadUserWorker: loadArticleCapableUserWorker });
  const snapshot = get(capabilitySnapshot);

  if (snapshot.articles.kind === 'none') {
    return {
      started: false,
      reason:
        'no article backend available — start the local helper or set up a custom worker that supports article extraction',
    };
  }

  const controller = new AbortController();
  activeController = controller;

  // Mark articles as enabled so the discovery banner stops re-showing.
  void setBackupEnabled('articles', true);

  void hydrateArticles(inventory, { signal: controller.signal }).finally(() => {
    if (activeController === controller) activeController = null;
  });

  return { started: true };
}

export function cancelArticleBackup(): void {
  activeController?.abort();
}
