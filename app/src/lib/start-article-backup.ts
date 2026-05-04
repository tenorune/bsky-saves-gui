// Run-lifecycle helper for article backup. Wraps article-hydrator with the
// controls the UI needs:
//
// - startArticleBackup(inventory): probes the helper specifically (article
//   extraction needs server-side trafilatura, which the user-worker template
//   doesn't run). Returns {started:false, reason} if no helper. Otherwise
//   spawns the hydration loop and returns {started:true}.
//
// - cancelArticleBackup(): aborts the most recent run, or no-op.

import { probeConfiguredHelper } from './helper-client';
import { hydrateArticles } from './article-hydrator';
import { setBackupEnabled } from './backup-prefs';

export interface StartArticleResult {
  readonly started: boolean;
  readonly reason?: string;
}

let activeController: AbortController | null = null;

export async function startArticleBackup(inventory: unknown): Promise<StartArticleResult> {
  const helper = await probeConfiguredHelper();
  if (helper.status !== 'available') {
    return {
      started: false,
      reason:
        'Article backup needs the local bsky-saves helper. ' +
        'Install bsky-saves and run `bsky-saves serve`. ' +
        'Cloudflare Worker proxies do not yet support article extraction.',
    };
  }
  if (!helper.features.includes('extract-article')) {
    return {
      started: false,
      reason: `Local helper (bsky-saves ${helper.version}) does not advertise article extraction. Update bsky-saves.`,
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
