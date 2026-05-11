// Run-lifecycle helper for image backup. Wraps the Plan 4 image-hydrator
// with the controls the UI needs:
//
// - startImageBackup(inventory): probes backends. Refuses to start with a
//   reason when none are configured. Otherwise spawns the hydration loop
//   in the background and returns immediately.
//
// - cancelImageBackup(): aborts the most recent run, if any.
//
// Module-level AbortController is fine here — image hydration is a singleton
// operation. Plan 7+ may refactor when article hydration arrives.

import { config } from './config';
import { fetchImageViaHelper } from './helper-client';
import { detectBackends, type Backend } from './image-fetcher';
import { hydrateImages } from './image-hydrator';
import { fetchImageViaUserWorker } from './user-worker-client';

export interface StartResult {
  readonly started: boolean;
  readonly reason?: string;
}

let activeController: AbortController | null = null;

export async function startImageBackup(inventory: unknown): Promise<StartResult> {
  const backends = await detectBackends();
  if (backends.length === 0) {
    return {
      started: false,
      reason:
        'No backup method is set up. Install bsky-saves locally (run `bsky-saves serve`) ' +
        'or configure a Cloudflare Worker proxy in Settings.',
    };
  }

  const controller = new AbortController();
  activeController = controller;

  // Bind a fetcher to the backend we already detected. This avoids re-probing
  // on every image and ensures the whole run uses one consistent backend.
  const fetcher = makeBoundFetcher(backends[0]);

  // Fire-and-forget. The hydration loop updates imageHydration as it goes.
  // We clear activeController when this run finishes so cancelImageBackup
  // doesn't try to abort a stale controller.
  void hydrateImages(inventory, { signal: controller.signal, fetcher }).finally(() => {
    if (activeController === controller) activeController = null;
  });

  return { started: true };
}

export function cancelImageBackup(): void {
  activeController?.abort();
}

function makeBoundFetcher(backend: Backend): (url: string) => Promise<Blob> {
  if (backend.kind === 'helper') {
    return (url) => fetchImageViaHelper(config.helperOrigin, url);
  }
  return (url) => fetchImageViaUserWorker(backend.config, url);
}
