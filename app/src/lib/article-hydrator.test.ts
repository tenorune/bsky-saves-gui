import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';
import type { CapabilitySnapshot } from './capability-snapshot';

vi.mock('./helper-client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./helper-client')>();
  return { ...mod, extractArticleViaHelper: vi.fn() };
});

vi.mock('./user-worker-client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./user-worker-client')>();
  return { ...mod, extractArticleViaWorker: vi.fn() };
});

beforeEach(async () => {
  const { clearInventory } = await import('./inventory-store');
  await clearInventory();
  const { resetArticleHydration } = await import('./hydration-state');
  resetArticleHydration();
});

const makeInventory = () => ({
  saves: [
    {
      uri: 'a',
      embed: { url: 'https://example.com/a' },
    },
    {
      uri: 'b',
      embed: { url: 'https://example.com/b' },
    },
    {
      uri: 'c',
      embed: { url: 'https://example.com/c' },
      article_text: 'already there',
    },
  ],
});

describe('hydrateArticles happy path', () => {
  it('fetches each unhydrated URL and writes article_text + title onto each save', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      url,
      title: `Title for ${url}`,
      text: `Body for ${url}`,
      fetched_at: '2026-05-04T12:00:00Z',
    }));
    const inv = makeInventory();
    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(inv, { fetcher });
    expect(result).toEqual({ fetched: 2, skipped: 1, failed: 0, cancelled: false });
    expect((inv.saves[0] as Record<string, unknown>).article_text).toBe('Body for https://example.com/a');
    expect((inv.saves[0] as Record<string, unknown>).article_title).toBe('Title for https://example.com/a');
    expect((inv.saves[1] as Record<string, unknown>).article_text).toBe('Body for https://example.com/b');
    expect((inv.saves[2] as Record<string, unknown>).article_text).toBe('already there'); // untouched
  });

  it('persists the mutated inventory to IDB at the end', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      url,
      title: 't',
      text: 't',
      fetched_at: '2026-05-04T12:00:00Z',
    }));
    const inv = makeInventory();
    const { hydrateArticles } = await import('./article-hydrator');
    await hydrateArticles(inv, { fetcher });
    const { loadInventory } = await import('./inventory-store');
    const fromDb = (await loadInventory()) as { saves: Array<Record<string, unknown>> };
    expect(fromDb.saves[0].article_text).toBe('t');
  });

  it('updates articleHydration store progressively', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      url,
      title: 't',
      text: 't',
      fetched_at: '2026-05-04T12:00:00Z',
    }));
    const { hydrateArticles } = await import('./article-hydrator');
    const { articleHydration } = await import('./hydration-state');
    await hydrateArticles(makeInventory(), { fetcher });
    const final = get(articleHydration);
    expect(final.status).toBe('done');
    // total is the full article-eligible set (allUrls), so already-hydrated
    // articles are counted toward total too. fetched + skipped reflects the
    // cumulative-hydrated coverage.
    expect(final.total).toBe(3);
    expect(final.fetched).toBe(2);
    expect(final.skipped).toBe(1);
  });
});

describe('hydrateArticles records failures without aborting', () => {
  it('continues past failed URLs', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://example.com/a') throw new Error('paywall');
      return { url, title: 't', text: 't', fetched_at: '2026-05-04T12:00:00Z' };
    });
    const inv = makeInventory();
    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(inv, { fetcher });
    expect(result).toEqual({ fetched: 1, skipped: 1, failed: 1, cancelled: false });
    expect((inv.saves[0] as Record<string, unknown>).article_text).toBeUndefined();
    expect((inv.saves[1] as Record<string, unknown>).article_text).toBe('t');
    const { articleHydration } = await import('./hydration-state');
    expect(get(articleHydration).failures).toEqual([
      { url: 'https://example.com/a', reason: 'paywall' },
    ]);
  });
});

describe('hydrateArticles cancellation', () => {
  it('exits cleanly between iterations when signal is aborted', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      calls++;
      if (calls === 1) controller.abort();
      return { url, title: 't', text: 't', fetched_at: '2026-05-04T12:00:00Z' };
    });
    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(makeInventory(), {
      fetcher,
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    const { articleHydration } = await import('./hydration-state');
    expect(get(articleHydration).status).toBe('cancelled');
  });
});

describe('hydrateArticles aborts in-flight fetch when signal fires', () => {
  it('aborts the in-flight fetch when signal is triggered', async () => {
    const ctrl = new AbortController();
    let resolveAbort!: () => void;
    let abortedDuringFetch = false;

    // A fetcher that simulates a slow in-flight request respecting AbortSignal.
    const fetcher = vi.fn((_url: string) =>
      new Promise<{ url: string; title: string; text: string; fetched_at: string }>(
        (_resolve, reject) => {
          ctrl.signal.addEventListener('abort', () => {
            abortedDuringFetch = true;
            resolveAbort?.();
            reject(new DOMException('aborted', 'AbortError'));
          });
        },
      ),
    );

    const { hydrateArticles } = await import('./article-hydrator');
    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }] };
    const promise = hydrateArticles(inv, { fetcher, signal: ctrl.signal });

    // Give the fetcher a tick to start, then abort.
    await new Promise((r) => { resolveAbort = r as () => void; setTimeout(r, 5); });
    ctrl.abort();

    const r = await promise;
    expect(r.cancelled).toBe(true);
    expect(abortedDuringFetch).toBe(true);
    const { articleHydration } = await import('./hydration-state');
    expect(get(articleHydration).status).toBe('cancelled');
  });
});

describe('hydrateArticles writes save.article', () => {
  it('also writes save.article so the renderer sees the new article text', async () => {
    const fetcher = vi.fn(async (_url: string) => ({
      url: 'https://a.example/p',
      title: 'Hello',
      text: 'body text',
      fetched_at: '2026-05-05T00:00:00Z',
    }));
    const inv = { saves: [{ uri: 'a', embed: { url: 'https://a.example/p' } } as Record<string, unknown>] };
    const { hydrateArticles } = await import('./article-hydrator');
    await hydrateArticles(inv, { fetcher });
    const save = inv.saves[0];
    expect(save.article_text).toBe('body text');
    expect(save.article).toEqual({ url: 'https://a.example/p', text: 'body text', title: 'Hello' });
  });
});

describe('hydrateArticles snapshot-based dispatch', () => {
  it('routes to user-worker when snapshot.articles.kind is user-worker', async () => {
    const { extractArticleViaWorker } = await import('./user-worker-client');
    vi.mocked(extractArticleViaWorker).mockResolvedValue({
      url: 'https://a.example/p', title: 'T', text: 'body', fetched_at: '2026-05-05T00:00:00Z',
    });
    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }] };
    const { hydrateArticles } = await import('./article-hydrator');
    const r = await hydrateArticles(inv, {
      getSnapshot: () => ({
        helper: { detected: false },
        fetch: { kind: 'pyodide' },
        enrich: { kind: 'pyodide' },
        threads: { kind: 'pyodide' },
        images: { kind: 'operator-worker' },
        articles: { kind: 'user-worker', url: 'https://w.example/', sharedSecret: 'test-secret' },
        pyodideSource: 'cdn',
        loaded: true,
      }),
    });
    expect(r.fetched).toBe(1);
    expect(r.failed).toBe(0);
    expect(vi.mocked(extractArticleViaWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://w.example/' }),
      'https://a.example/p',
      expect.any(Object),
    );
  });

  it('fails with a clear note when snapshot.articles.kind is none', async () => {
    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }] };
    const { hydrateArticles } = await import('./article-hydrator');
    const r = await hydrateArticles(inv, {
      getSnapshot: () => ({
        helper: { detected: false },
        fetch: { kind: 'pyodide' },
        enrich: { kind: 'pyodide' },
        threads: { kind: 'pyodide' },
        images: { kind: 'operator-worker' },
        articles: { kind: 'none' },
        pyodideSource: 'cdn',
        loaded: true,
      }),
    });
    expect(r.failed).toBe(1);
  });
});

const makeSingleArticleInv = () => ({
  saves: [{ uri: 'a', embed: { url: 'https://a.example/article' } }],
});

const okArticle = (url: string) => ({
  url,
  title: 'Test Title',
  text: 'Test body text',
  fetched_at: '2026-05-07T00:00:00Z',
});

function fakeSnapshot(articles: CapabilitySnapshot['articles']): CapabilitySnapshot {
  return {
    helper: { detected: false },
    fetch: { kind: 'pyodide' },
    enrich: { kind: 'pyodide' },
    threads: { kind: 'pyodide' },
    images: { kind: 'operator-worker' },
    articles,
    pyodideSource: 'cdn',
    loaded: true,
  };
}

describe('hydrateArticles snapshot routing: helper', () => {
  it('calls extractArticleViaHelper when snapshot.articles.kind is helper', async () => {
    const { extractArticleViaHelper } = await import('./helper-client');
    vi.mocked(extractArticleViaHelper).mockResolvedValue(okArticle('https://a.example/article'));

    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(makeSingleArticleInv(), {
      getSnapshot: () => fakeSnapshot({ kind: 'helper' }),
    });

    expect(result.fetched).toBe(1);
    expect(result.failed).toBe(0);
    expect(vi.mocked(extractArticleViaHelper)).toHaveBeenCalledWith(
      expect.any(String),
      'https://a.example/article',
      expect.any(Object),
    );
  });
});

describe('hydrateArticles snapshot routing: user-worker', () => {
  it('calls extractArticleViaWorker with the snapshot URL when kind is user-worker', async () => {
    const { extractArticleViaWorker } = await import('./user-worker-client');
    vi.mocked(extractArticleViaWorker).mockResolvedValue(okArticle('https://a.example/article'));

    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(makeSingleArticleInv(), {
      getSnapshot: () => fakeSnapshot({ kind: 'user-worker', url: 'https://worker.example.com', sharedSecret: 'test-secret' }),
    });

    expect(result.fetched).toBe(1);
    expect(result.failed).toBe(0);
    expect(vi.mocked(extractArticleViaWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://worker.example.com' }),
      'https://a.example/article',
      expect.any(Object),
    );
  });
});

describe('hydrateArticles snapshot routing: none', () => {
  it('records a failure for each URL when snapshot.articles.kind is none', async () => {
    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(makeSingleArticleInv(), {
      getSnapshot: () => fakeSnapshot({ kind: 'none' }),
    });

    expect(result.fetched).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.cancelled).toBe(false);
    const { articleHydration } = await import('./hydration-state');
    expect(get(articleHydration).failures).toHaveLength(1);
    expect(get(articleHydration).failures[0].url).toBe('https://a.example/article');
  });
});

// Regression coverage for the article-side analog of issue #15
// (sibling of PR #20's threads fix). Until the fix, hydrateArticles
// wrote the mutated inventory to IDB but never refreshed
// inventoryState — Library/Post views showed stale article-less
// saves until the user hard-refreshed the tab.
describe('hydrateArticles refreshes inventoryState after persisting', () => {
  it('inventoryState reflects the new article_text after a successful end-of-run persist', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      url,
      title: `Title for ${url}`,
      text: `Body for ${url}`,
      fetched_at: '2026-05-04T12:00:00Z',
    }));
    const inv = makeInventory();
    const { saveInventory } = await import('./inventory-store');
    // Seed IDB + inventoryState with the pre-hydration inventory so the
    // test starts from a "Library is rendered, threads-toggle just got
    // flipped" steady state.
    await saveInventory(inv);
    const { loadFromDb, inventoryState } = await import('./inventory-loader');
    await loadFromDb();
    const before = get(inventoryState);
    expect(before.status).toBe('ready');
    if (before.status === 'ready') {
      const a = before.inventory.saves.find((s) => s.uri === 'a');
      expect(a?.article).toBeUndefined();
    }

    const { hydrateArticles } = await import('./article-hydrator');
    await hydrateArticles(inv, { fetcher });

    // Without the fix this assertion fails — inventoryState still
    // reflects the pre-hydration snapshot until the user refreshes.
    const after = get(inventoryState);
    expect(after.status).toBe('ready');
    if (after.status === 'ready') {
      const a = after.inventory.saves.find((s) => s.uri === 'a');
      expect(a?.article).toBeDefined();
      expect(a?.article?.text).toBe('Body for https://example.com/a');
    }
  });

  it('inventoryState reflects partial progress after a cancel', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      calls++;
      // Cancel after the first successful fetch but before the second.
      if (calls === 1) {
        queueMicrotask(() => controller.abort());
      }
      return {
        url,
        title: `Title for ${url}`,
        text: `Body for ${url}`,
        fetched_at: '2026-05-04T12:00:00Z',
      };
    });
    const inv = makeInventory();
    const { saveInventory } = await import('./inventory-store');
    await saveInventory(inv);
    const { loadFromDb, inventoryState } = await import('./inventory-loader');
    await loadFromDb();

    const { hydrateArticles } = await import('./article-hydrator');
    const result = await hydrateArticles(inv, { fetcher, signal: controller.signal });
    expect(result.cancelled).toBe(true);

    // The first fetch's result IS persisted on the cancel branch and
    // inventoryState should reflect it.
    const after = get(inventoryState);
    expect(after.status).toBe('ready');
    if (after.status === 'ready') {
      const a = after.inventory.saves.find((s) => s.uri === 'a');
      expect(a?.article?.text).toBe('Body for https://example.com/a');
    }
  });
});
