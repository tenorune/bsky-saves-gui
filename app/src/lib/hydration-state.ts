// Singleton Svelte store for image-hydration progress. Subscribed to by
// the Library status row, the PostFocus backup footer, and the Show Details
// modal. Updated by image-hydrator's background loop.
//
// A second store (articleHydration) will be added in a later plan when
// article backup lands; the shape is identical.

import { writable, type Writable } from 'svelte/store';

export type HydrationStatus = 'idle' | 'running' | 'paused' | 'cancelling' | 'done' | 'cancelled';

export interface HydrationFailure {
  readonly url: string;
  readonly reason: string;
}

export interface HydrationProgress {
  readonly status: HydrationStatus;
  readonly total: number;
  readonly fetched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly failures: readonly HydrationFailure[];
}

const INITIAL: HydrationProgress = {
  status: 'idle',
  total: 0,
  fetched: 0,
  skipped: 0,
  failed: 0,
  failures: [],
};

export const imageHydration: Writable<HydrationProgress> = writable(INITIAL);

export function resetImageHydration(): void {
  imageHydration.set(INITIAL);
}

export const articleHydration: Writable<HydrationProgress> = writable(INITIAL);

export function resetArticleHydration(): void {
  articleHydration.set(INITIAL);
}

export const fetchProgress: Writable<HydrationProgress> = writable(INITIAL);

export function resetFetchProgress(): void {
  fetchProgress.set(INITIAL);
}

export const enrichProgress: Writable<HydrationProgress> = writable(INITIAL);

export function resetEnrichProgress(): void {
  enrichProgress.set(INITIAL);
}

export const threadProgress: Writable<HydrationProgress> = writable(INITIAL);

export function resetThreadProgress(): void {
  threadProgress.set(INITIAL);
}

/**
 * Reset every hydration-progress store to its idle initial state.
 *
 * Call this at user-identity-change boundaries — sign-in (SignIn.submit)
 * and Clear data (Settings.clearAll) — so a fresh account never briefly
 * shows the previous account's residual progress counters. The five
 * stores are module-level singletons (see issue #19's audit); without an
 * explicit reset they retain whatever the last run left behind until the
 * new account's library-refresh overwrites them a frame or two later.
 *
 * Not a privacy concern (the stores hold only counters + failed-URL
 * strings, no handles/DIDs/inventory), but an account-context one — a
 * new user shouldn't see "412/1000 hydrated" inherited from someone else.
 */
export function resetAllHydrationProgress(): void {
  resetImageHydration();
  resetArticleHydration();
  resetFetchProgress();
  resetEnrichProgress();
  resetThreadProgress();
}
