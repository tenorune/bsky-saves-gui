import { describe, expect, it } from 'vitest';
import type { Save } from './inventory-shape';

function s(uri: string, text: string, handle: string, createdAt: string): Save {
  return {
    uri,
    cid: 'c',
    author: { did: 'd', handle },
    record: { text, createdAt },
    indexedAt: createdAt,
  };
}

describe('filterSaves', () => {
  const saves: Save[] = [
    s('at://x/y/1', 'hello world', 'alice.bsky.social', '2026-04-01T00:00:00Z'),
    s('at://x/y/2', 'goodbye world', 'bob.example', '2026-04-15T00:00:00Z'),
    s('at://x/y/3', 'lunch?', 'alice.bsky.social', '2026-05-01T00:00:00Z'),
  ];

  it('returns all saves when query is empty and no date range', async () => {
    const { filterSaves } = await import('./feed-filter');
    expect(filterSaves(saves, { query: '', from: null, to: null })).toEqual(saves);
  });

  it('filters by case-insensitive substring across post text and handle', async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(saves, { query: 'BOB', from: null, to: null });
    expect(r).toHaveLength(1);
    expect(r[0].author.handle).toBe('bob.example');

    const r2 = filterSaves(saves, { query: 'world', from: null, to: null });
    expect(r2).toHaveLength(2);
  });

  it('filters by from-date (inclusive) using the post createdAt', async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(saves, { query: '', from: '2026-04-15', to: null });
    expect(r.map((x) => x.uri)).toEqual(['at://x/y/2', 'at://x/y/3']);
  });

  it('filters by to-date (inclusive end-of-day)', async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(saves, { query: '', from: null, to: '2026-04-15' });
    expect(r.map((x) => x.uri)).toEqual(['at://x/y/1', 'at://x/y/2']);
  });

  it('combines query with date range', async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(saves, { query: 'alice', from: '2026-04-15', to: null });
    expect(r.map((x) => x.uri)).toEqual(['at://x/y/3']);
  });
});

describe('sortByCreatedDesc', () => {
  it('sorts saves newest-first by record.createdAt', async () => {
    const { sortByCreatedDesc } = await import('./feed-filter');
    const sorted = sortByCreatedDesc([
      s('a', 't', 'h', '2026-04-01T00:00:00Z'),
      s('b', 't', 'h', '2026-05-01T00:00:00Z'),
      s('c', 't', 'h', '2026-04-15T00:00:00Z'),
    ]);
    expect(sorted.map((x) => x.uri)).toEqual(['b', 'c', 'a']);
  });
});
