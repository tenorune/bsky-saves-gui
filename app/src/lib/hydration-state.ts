// Singleton Svelte store for image-hydration progress. Subscribed to by
// the Library status row, the PostFocus backup footer, and the Show Details
// modal. Updated by image-hydrator's background loop.
//
// A second store (articleHydration) will be added in a later plan when
// article backup lands; the shape is identical.

import { writable, type Writable } from 'svelte/store';

export type HydrationStatus = 'idle' | 'running' | 'paused' | 'done' | 'cancelled';

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
