import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';

beforeEach(async () => {
  const { resetImageHydration, resetArticleHydration } = await import('./hydration-state');
  resetImageHydration();
  resetArticleHydration();
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

  it('articleHydration starts in the same idle state', async () => {
    const { articleHydration } = await import('./hydration-state');
    expect(get(articleHydration)).toEqual({
      status: 'idle',
      total: 0,
      fetched: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  });

  it('resetArticleHydration restores the initial state', async () => {
    const { articleHydration, resetArticleHydration } = await import('./hydration-state');
    articleHydration.set({
      status: 'running',
      total: 3,
      fetched: 1,
      skipped: 0,
      failed: 1,
      failures: [{ url: 'https://x', reason: 'paywall' }],
    });
    resetArticleHydration();
    expect(get(articleHydration).status).toBe('idle');
    expect(get(articleHydration).total).toBe(0);
  });

  it('image and article stores are independent', async () => {
    const { imageHydration, articleHydration } = await import('./hydration-state');
    imageHydration.set({
      status: 'running',
      total: 5,
      fetched: 2,
      skipped: 0,
      failed: 0,
      failures: [],
    });
    expect(get(articleHydration).status).toBe('idle');
    expect(get(imageHydration).status).toBe('running');
  });
});

describe('fetchProgress', () => {
  it('initializes idle', async () => {
    const { fetchProgress } = await import('./hydration-state');
    expect(get(fetchProgress).status).toBe('idle');
  });
  it('reset clears state', async () => {
    const { fetchProgress, resetFetchProgress } = await import('./hydration-state');
    fetchProgress.set({ status: 'running', total: 10, fetched: 3, skipped: 0, failed: 0, failures: [] });
    resetFetchProgress();
    expect(get(fetchProgress).status).toBe('idle');
  });
});

describe('enrichProgress', () => {
  it('initializes idle', async () => {
    const { enrichProgress } = await import('./hydration-state');
    expect(get(enrichProgress).status).toBe('idle');
  });
});

describe('threadProgress', () => {
  it('initializes idle', async () => {
    const { threadProgress } = await import('./hydration-state');
    expect(get(threadProgress).status).toBe('idle');
  });
});

describe('resetAllHydrationProgress', () => {
  it('resets all five progress stores to idle in one call (issue #24)', async () => {
    const mod = await import('./hydration-state');
    const stores = [
      mod.imageHydration,
      mod.articleHydration,
      mod.fetchProgress,
      mod.enrichProgress,
      mod.threadProgress,
    ];
    // Dirty every store with a distinct non-idle state.
    for (const store of stores) {
      store.set({ status: 'running', total: 9, fetched: 4, skipped: 1, failed: 2, failures: [{ url: 'https://x', reason: 'boom' }] });
    }
    for (const store of stores) {
      expect(get(store).status).toBe('running');
    }

    mod.resetAllHydrationProgress();

    for (const store of stores) {
      expect(get(store)).toEqual({
        status: 'idle',
        total: 0,
        fetched: 0,
        skipped: 0,
        failed: 0,
        failures: [],
      });
    }
  });
});
