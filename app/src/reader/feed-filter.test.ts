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

describe('filterSaves "Show" filter', () => {
  const synced = s('at://x/y/synced', 'a live save', 'alice.bsky.social', '2026-04-01T00:00:00Z');
  const lostNotFound: Save = {
    ...s('at://x/y/lost1', 'deleted by poster', 'bob.example', '2026-04-02T00:00:00Z'),
    subject_status: 'not_found',
  };
  const lostBlocked: Save = {
    ...s('at://x/y/lost2', 'blocked by poster', 'carol.example', '2026-04-03T00:00:00Z'),
    subject_status: 'blocked',
  };
  const unsaved: Save = {
    ...s('at://x/y/unsaved', 'I un-saved this', 'dave.example', '2026-04-04T00:00:00Z'),
    removed_detected_at: '2026-04-10T00:00:00Z',
  };
  const unknown: Save = {
    ...s('at://x/y/unknown', 'content-blind fallback', 'eve.example', '2026-04-05T00:00:00Z'),
    subject_status: 'unknown',
  };
  const all: Save[] = [synced, lostNotFound, lostBlocked, unsaved, unknown];

  it("'all' returns everything", async () => {
    const { filterSaves } = await import('./feed-filter');
    expect(filterSaves(all, { query: '', from: null, to: null, show: 'all' })).toEqual(all);
  });

  it('an absent show behaves like \'all\'', async () => {
    const { filterSaves } = await import('./feed-filter');
    expect(filterSaves(all, { query: '', from: null, to: null })).toEqual(all);
  });

  it("'synced' keeps only live, still-saved entries", async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(all, { query: '', from: null, to: null, show: 'synced' });
    expect(r.map((x) => x.uri)).toEqual(['at://x/y/synced']);
  });

  it("'lost' keeps not_found and blocked subjects", async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(all, { query: '', from: null, to: null, show: 'lost' });
    expect(r.map((x) => x.uri)).toEqual(['at://x/y/lost1', 'at://x/y/lost2']);
  });

  it("'unsaved' keeps only entries with removed_detected_at", async () => {
    const { filterSaves } = await import('./feed-filter');
    const r = filterSaves(all, { query: '', from: null, to: null, show: 'unsaved' });
    expect(r.map((x) => x.uri)).toEqual(['at://x/y/unsaved']);
  });

  it("an 'unknown'-status entry matches only 'all'", async () => {
    const { filterSaves } = await import('./feed-filter');
    for (const show of ['synced', 'lost', 'unsaved'] as const) {
      expect(filterSaves([unknown], { query: '', from: null, to: null, show })).toEqual([]);
    }
    expect(filterSaves([unknown], { query: '', from: null, to: null, show: 'all' })).toEqual([
      unknown,
    ]);
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
