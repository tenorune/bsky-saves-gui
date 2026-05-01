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
});
