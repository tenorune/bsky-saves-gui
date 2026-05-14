import { describe, expect, it } from 'vitest';

describe('inventory-shape', () => {
  it('parseInventory accepts a minimal valid object and rejects garbage', async () => {
    const { parseInventory, ParseError } = await import('./inventory-shape');

    const ok = parseInventory({
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/3l00',
          cid: 'cid1',
          author: { did: 'did:plc:abc', handle: 'alice.bsky.social' },
          record: { text: 'hi', createdAt: '2026-04-01T12:00:00Z' },
          indexedAt: '2026-04-01T12:00:00Z',
        },
      ],
    });
    expect(ok.saves).toHaveLength(1);

    expect(() => parseInventory({})).toThrow(ParseError);
    expect(() => parseInventory({ saves: 'not-an-array' })).toThrow(ParseError);
    expect(() => parseInventory(null)).toThrow(ParseError);
  });

  it('rkeyOf extracts the trailing segment from an at-uri', async () => {
    const { rkeyOf } = await import('./inventory-shape');
    expect(rkeyOf('at://did:plc:abc/app.bsky.feed.post/3l00')).toBe('3l00');
    expect(rkeyOf('at://did:plc:abc/app.bsky.feed.post/abc-123')).toBe('abc-123');
  });

  it('preserves unknown extras through parse', async () => {
    const { parseInventory } = await import('./inventory-shape');
    const got = parseInventory({
      saves: [
        {
          uri: 'at://x/y/z',
          cid: 'c',
          author: { did: 'd', handle: 'h' },
          record: { text: 't', createdAt: '2026-01-01T00:00:00Z' },
          indexedAt: '2026-01-01T00:00:00Z',
          custom_extension: { weird: 'value' },
        },
      ],
    });
    expect((got.saves[0] as any).custom_extension).toEqual({ weird: 'value' });
  });

  // v0.6.0 retain-flag — Task A: the four lifecycle fields are typed
  // pass-throughs on Save, validated by parseSave.
  it('parses the v0.6.0 lifecycle fields when present', async () => {
    const { parseInventory } = await import('./inventory-shape');
    const got = parseInventory({
      saves: [
        {
          uri: 'at://x/y/z',
          author: { did: 'd', handle: 'h' },
          record: { text: 't', createdAt: '2026-01-01T00:00:00Z' },
          last_seen_at: '2026-05-14T12:00:00Z',
          removed_detected_at: '2026-05-10T00:00:00Z',
          subject_status: 'not_found',
          subject_status_detected_at: '2026-05-05T00:00:00Z',
        },
      ],
    });
    const s = got.saves[0];
    expect(s.last_seen_at).toBe('2026-05-14T12:00:00Z');
    expect(s.removed_detected_at).toBe('2026-05-10T00:00:00Z');
    expect(s.subject_status).toBe('not_found');
    expect(s.subject_status_detected_at).toBe('2026-05-05T00:00:00Z');
  });

  it('drops a malformed subject_status to undefined rather than letting it through', async () => {
    const { parseInventory } = await import('./inventory-shape');
    const got = parseInventory({
      saves: [
        {
          uri: 'at://x/y/z',
          author: { did: 'd', handle: 'h' },
          record: { text: 't', createdAt: '2026-01-01T00:00:00Z' },
          subject_status: 'garbage',
        },
      ],
    });
    expect(got.saves[0].subject_status).toBeUndefined();
  });

  it('leaves the lifecycle fields undefined on a pre-v0.6.0 (flag-less) save', async () => {
    const { parseInventory } = await import('./inventory-shape');
    const got = parseInventory({
      saves: [
        {
          uri: 'at://x/y/z',
          author: { did: 'd', handle: 'h' },
          record: { text: 't', createdAt: '2026-01-01T00:00:00Z' },
        },
      ],
    });
    const s = got.saves[0];
    expect(s.last_seen_at).toBeUndefined();
    expect(s.removed_detected_at).toBeUndefined();
    expect(s.subject_status).toBeUndefined();
    expect(s.subject_status_detected_at).toBeUndefined();
  });
});
