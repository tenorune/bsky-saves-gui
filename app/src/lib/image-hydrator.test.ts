import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';
import type { CapabilitySnapshot } from './capability-snapshot';

vi.mock('./helper-client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./helper-client')>();
  return { ...mod, fetchImageViaHelper: vi.fn() };
});

vi.mock('./user-worker-client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./user-worker-client')>();
  return { ...mod, fetchImageViaUserWorker: vi.fn() };
});

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
  const { resetImageHydration } = await import('./hydration-state');
  resetImageHydration();
});

const inv = {
  saves: [
    {
      uri: 'a',
      images: [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }],
    },
    {
      uri: 'b',
      thread_replies: [{ images: [{ url: 'https://x/3.jpg' }] }],
    },
  ],
};

const okBlob = (n: number) => new Blob([`IMG${n}`], { type: 'image/png' });

describe('hydrateImages happy path', () => {
  it('fetches every URL, writes to image-store, and reports done', async () => {
    const fetcher = vi.fn(async (url: string) => okBlob(url.length));
    const { hydrateImages } = await import('./image-hydrator');
    const { imageHydration } = await import('./hydration-state');
    const result = await hydrateImages(inv, { fetcher });
    expect(result).toEqual({ fetched: 3, skipped: 0, failed: 0, cancelled: false });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(get(imageHydration)).toMatchObject({
      status: 'done',
      total: 3,
      fetched: 3,
      skipped: 0,
      failed: 0,
    });

    const { hasImageBlob } = await import('./image-store');
    expect(await hasImageBlob('https://x/1.jpg')).toBe(true);
    expect(await hasImageBlob('https://x/2.jpg')).toBe(true);
    expect(await hasImageBlob('https://x/3.jpg')).toBe(true);
  });
});

describe('hydrateImages skips already-cached URLs', () => {
  it('does not call the fetcher for URLs whose blob is already stored', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://x/1.jpg', okBlob(1));
    await saveImageBlob('https://x/2.jpg', okBlob(2));
    const fetcher = vi.fn(async () => okBlob(99));
    const { hydrateImages } = await import('./image-hydrator');
    const result = await hydrateImages(inv, { fetcher });
    expect(result).toEqual({ fetched: 1, skipped: 2, failed: 0, cancelled: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://x/3.jpg');
  });
});

describe('hydrateImages records failures without aborting the run', () => {
  it('continues past failed URLs and exposes the reasons', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://x/2.jpg') throw new Error('upstream 404');
      return okBlob(1);
    });
    const { hydrateImages } = await import('./image-hydrator');
    const { imageHydration } = await import('./hydration-state');
    const result = await hydrateImages(inv, { fetcher });
    expect(result).toEqual({ fetched: 2, skipped: 0, failed: 1, cancelled: false });
    const state = get(imageHydration);
    expect(state.status).toBe('done');
    expect(state.failures).toEqual([
      { url: 'https://x/2.jpg', reason: 'upstream 404' },
    ]);
  });
});

describe('hydrateImages handles an empty URL list', () => {
  it('returns done immediately with zero counters', async () => {
    const fetcher = vi.fn(async () => okBlob(1));
    const { hydrateImages } = await import('./image-hydrator');
    const { imageHydration } = await import('./hydration-state');
    const result = await hydrateImages({ saves: [] }, { fetcher });
    expect(result).toEqual({ fetched: 0, skipped: 0, failed: 0, cancelled: false });
    expect(get(imageHydration).status).toBe('done');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('hydrateImages respects AbortSignal cancellation', () => {
  it('stops between iterations when the signal aborts and reports cancelled', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetcher = vi.fn(async (_url: string) => {
      calls++;
      if (calls === 1) controller.abort(); // abort right after first fetch
      return okBlob(1);
    });
    const { hydrateImages } = await import('./image-hydrator');
    const { imageHydration } = await import('./hydration-state');
    const result = await hydrateImages(inv, { fetcher, signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.fetched).toBeLessThan(3);
    expect(get(imageHydration).status).toBe('cancelled');
  });
});

const singleImageInv = { saves: [{ uri: 'a', images: [{ url: 'https://x/1.jpg' }] }] };

function fakeSnapshot(images: CapabilitySnapshot['images']): CapabilitySnapshot {
  return {
    helper: { detected: false },
    fetch: { kind: 'pyodide' },
    enrich: { kind: 'pyodide' },
    threads: { kind: 'pyodide' },
    images,
    articles: { kind: 'none' },
    loaded: true,
  };
}

describe('hydrateImages snapshot routing: helper', () => {
  it('calls fetchImageViaHelper when snapshot.images.kind is helper', async () => {
    const { fetchImageViaHelper } = await import('./helper-client');
    vi.mocked(fetchImageViaHelper).mockResolvedValue(okBlob(1));

    const { hydrateImages } = await import('./image-hydrator');
    const result = await hydrateImages(singleImageInv, {
      getSnapshot: () => fakeSnapshot({ kind: 'helper' }),
    });

    expect(result.fetched).toBe(1);
    expect(vi.mocked(fetchImageViaHelper)).toHaveBeenCalledWith(
      expect.any(String),
      'https://x/1.jpg',
    );
  });
});

describe('hydrateImages snapshot routing: user-worker', () => {
  it('calls fetchImageViaUserWorker with the snapshot URL when kind is user-worker', async () => {
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    vi.mocked(fetchImageViaUserWorker).mockResolvedValue(okBlob(2));

    const { hydrateImages } = await import('./image-hydrator');
    const result = await hydrateImages(singleImageInv, {
      getSnapshot: () => fakeSnapshot({ kind: 'user-worker', url: 'https://worker.example.com', sharedSecret: 'test-secret' }),
    });

    expect(result.fetched).toBe(1);
    expect(vi.mocked(fetchImageViaUserWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://worker.example.com' }),
      'https://x/1.jpg',
    );
  });
});

describe('hydrateImages snapshot routing: operator-worker', () => {
  it('calls fetchImageViaUserWorker with operator config when kind is operator-worker', async () => {
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    vi.mocked(fetchImageViaUserWorker).mockResolvedValue(okBlob(3));

    const { hydrateImages } = await import('./image-hydrator');
    const result = await hydrateImages(singleImageInv, {
      getSnapshot: () => fakeSnapshot({ kind: 'operator-worker' }),
    });

    expect(result.fetched).toBe(1);
    expect(vi.mocked(fetchImageViaUserWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ supportsArticles: false }),
      'https://x/1.jpg',
    );
  });
});

describe('hydration invariant: count never resets across runs', () => {
  // Regression for the "count resets to 0 each Refresh" bug. The displayed
  // value (fetched + skipped) must reflect cumulative coverage from the
  // first frame of every run. Concretely: if a previous run hydrated K
  // images, a fresh run must report skipped >= K immediately on its first
  // store update — never start at skipped=0 and climb.
  it('reports skipped >= already-hydrated from the very first store update', async () => {
    const { hydrateImages } = await import('./image-hydrator');
    const { imageHydration } = await import('./hydration-state');

    // First run: fetch and persist all three image blobs.
    const fetcher1 = vi.fn(async (url: string) => okBlob(url.length));
    await hydrateImages(inv, { fetcher: fetcher1 });
    expect(get(imageHydration).fetched).toBe(3);

    // Capture every imageHydration.set/update during the second run.
    const observed: Array<{ skipped: number; fetched: number }> = [];
    const unsub = imageHydration.subscribe((s) =>
      observed.push({ skipped: s.skipped, fetched: s.fetched }),
    );

    const fetcher2 = vi.fn(async (url: string) => okBlob(url.length));
    await hydrateImages(inv, { fetcher: fetcher2 });
    unsub();

    // Strip the initial 'idle' subscription value (skipped=0, fetched=0)
    // that fired synchronously on subscribe BEFORE hydrateImages ran.
    // After that, every value must reflect skipped >= 3 (all blobs from
    // run 1 are already present).
    const duringRun = observed.slice(1);
    for (const v of duringRun) {
      expect(v.skipped).toBeGreaterThanOrEqual(3);
    }
    // And the fetcher should not have been called for any URL — the run
    // had nothing new to do.
    expect(fetcher2).not.toHaveBeenCalled();
  });
});
