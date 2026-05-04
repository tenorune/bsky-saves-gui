import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';

beforeEach(async () => {
  const { resetImageHydration } = await import('./hydration-state');
  resetImageHydration();
});

describe('hydration-state', () => {
  it('starts in the idle state with zero counters and empty failures', async () => {
    const { imageHydration } = await import('./hydration-state');
    expect(get(imageHydration)).toEqual({
      status: 'idle',
      total: 0,
      fetched: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  });

  it('resetImageHydration restores the initial state after mutation', async () => {
    const { imageHydration, resetImageHydration } = await import('./hydration-state');
    imageHydration.set({
      status: 'running',
      total: 5,
      fetched: 2,
      skipped: 1,
      failed: 1,
      failures: [{ url: 'https://x/oops', reason: 'HTTP 502' }],
    });
    expect(get(imageHydration).status).toBe('running');
    resetImageHydration();
    expect(get(imageHydration)).toEqual({
      status: 'idle',
      total: 0,
      fetched: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  });

  it('exposes the HydrationProgress type with all status variants', async () => {
    const { imageHydration } = await import('./hydration-state');
    // Type-level check via runtime: each status string is valid.
    const statuses = ['idle', 'running', 'paused', 'done', 'cancelled'] as const;
    for (const status of statuses) {
      imageHydration.update((s) => ({ ...s, status }));
      expect(get(imageHydration).status).toBe(status);
    }
  });
});
