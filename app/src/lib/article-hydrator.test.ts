import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';

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
    expect(final.total).toBe(2);
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
  beforeEach(async () => {
    vi.resetModules();
    const { clearInventory } = await import('./inventory-store');
    await clearInventory();
    const { resetArticleHydration } = await import('./hydration-state');
    resetArticleHydration();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts the in-flight fetch when signal is triggered', async () => {
    // Configure a proxy that supportsArticles so makeDefaultFetcher picks the
    // worker path (helper /ping returns 404 immediately, keeping the test fast).
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });

    let abortedDuringFetch = false;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      // Helper probe: return 404 quickly so the worker path is chosen.
      if (u.endsWith('/ping')) return new Response('nope', { status: 404 });
      // Mimic a slow upstream that respects AbortSignal.
      const sig = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        sig?.addEventListener('abort', () => {
          abortedDuringFetch = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
        // never resolves unless aborted
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { hydrateArticles } = await import('./article-hydrator');

    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }] };
    const ctrl = new AbortController();
    const promise = hydrateArticles(inv, { signal: ctrl.signal });

    // Give the fetch a tick to start, then abort.
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();

    const r = await promise;
    expect(r.cancelled).toBe(true);
    expect(abortedDuringFetch).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('hydrateArticles writes save.article', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { clearInventory } = await import('./inventory-store');
    await clearInventory();
    const { resetArticleHydration } = await import('./hydration-state');
    resetArticleHydration();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('also writes save.article so the renderer sees the new article text', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      if (u.endsWith('/ping')) {
        return {
          ok: true,
          json: async () => ({ name: 'bsky-saves', version: '0.3.0', features: ['extract-article'] }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          url: 'https://a.example/p',
          title: 'Hello',
          text: 'body text',
          fetched_at: '2026-05-05T00:00:00Z',
        }),
      };
    }));
    const inv = { saves: [{ uri: 'a', embed: { url: 'https://a.example/p' } } as Record<string, unknown>] };
    const { hydrateArticles } = await import('./article-hydrator');
    await hydrateArticles(inv);
    const save = inv.saves[0];
    expect(save.article_text).toBe('body text');
    expect(save.article).toEqual({ url: 'https://a.example/p', text: 'body text', title: 'Hello' });
    vi.unstubAllGlobals();
  });
});

describe('hydrateArticles default backend selection', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { clearInventory } = await import('./inventory-store');
    await clearInventory();
    const { resetArticleHydration } = await import('./hydration-state');
    resetArticleHydration();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses worker fetcher when helper is absent and worker supportsArticles', async () => {
    // The hydrator is given an inventory with one article URL.
    // We do NOT pass a custom fetcher, so the default backend-selection logic runs.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      if (u.endsWith('/ping')) return new Response('nope', { status: 404 });
      if (u.endsWith('/extract-article')) {
        return new Response(JSON.stringify({
          url: 'https://a.example/p', title: 'T', text: 'body', fetched_at: '2026-05-05T00:00:00Z',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${u}`);
    }));
    const { saveProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }] };
    const { hydrateArticles } = await import('./article-hydrator');
    const r = await hydrateArticles(inv);
    expect(r.fetched).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('flips supportsArticles to false on runtime 404 from worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const u = typeof input === 'string' ? input : (input as Request).url;
      if (u.endsWith('/ping')) return new Response('nope', { status: 404 });
      if (u.endsWith('/extract-article')) return new Response('not found', { status: 404 });
      throw new Error(`unexpected fetch ${u}`);
    }));
    const { saveProxyConfig, loadProxyConfig } = await import('./proxy-config');
    await saveProxyConfig({ url: 'https://w.example/', sharedSecret: 's', supportsArticles: true });
    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }, { embed: { url: 'https://a.example/q' } }] };
    const { hydrateArticles } = await import('./article-hydrator');
    const r = await hydrateArticles(inv);
    expect(r.failed).toBe(2);
    const updated = await loadProxyConfig();
    expect(updated?.supportsArticles).toBe(false);
  });

  it('fails with a clear note when neither helper nor worker is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const { clearProxyConfig } = await import('./proxy-config');
    await clearProxyConfig();
    const inv = { saves: [{ embed: { url: 'https://a.example/p' } }] };
    const { hydrateArticles } = await import('./article-hydrator');
    const r = await hydrateArticles(inv);
    expect(r.failed).toBe(1);
  });
});
