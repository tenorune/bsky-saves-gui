// Run-lifecycle helper for article backup. Wraps article-hydrator with the
// controls the UI needs:
//
// - startArticleBackup(inventory): probes available backends (helper or
//   user-deployed worker with article extraction). Returns {started:false,
//   reason} if neither is available. Otherwise spawns the hydration loop
//   (which picks the backend itself) and returns {started:true}.
//
// - cancelArticleBackup(): aborts the most recent run, or no-op.

import { probeConfiguredHelper } from './helper-client';
import { hydrateArticles } from './article-hydrator';
import { setBackupEnabled } from './backup-prefs';
import { loadProxyConfig } from './proxy-config';

export interface StartArticleResult {
  readonly started: boolean;
  readonly reason?: string;
}

let activeController: AbortController | null = null;

export async function startArticleBackup(inventory: unknown): Promise<StartArticleResult> {
  const helper = await probeConfiguredHelper();
  const helperOk =
    helper.status === 'available' && helper.features.includes('extract-article');

  if (!helperOk) {
    const proxy = await loadProxyConfig();
    if (!(proxy && proxy.supportsArticles)) {
      return {
        started: false,
        reason:
          'no article backend available — start the local helper or set up a custom worker that supports article extraction',
      };
    }
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
