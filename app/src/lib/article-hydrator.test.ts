import { describe, expect, it, beforeEach, vi } from 'vitest';
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
