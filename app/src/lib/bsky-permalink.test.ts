import { describe, expect, it } from 'vitest';
import { bskyPostUrl } from './bsky-permalink';

describe('bskyPostUrl', () => {
  it('builds the canonical permalink', () => {
    const url = bskyPostUrl({
      author: { handle: 'alice.bsky.social' },
      uri: 'at://did:plc:abc/app.bsky.feed.post/3kx9abc',
    });
    expect(url).toBe('https://bsky.app/profile/alice.bsky.social/post/3kx9abc');
  });

  it('URL-encodes the handle and rkey', () => {
    const url = bskyPostUrl({
      author: { handle: 'café.example' },
      uri: 'at://did:plc:abc/coll/rk e?y',
    });
    expect(url).toBe('https://bsky.app/profile/caf%C3%A9.example/post/rk%20e%3Fy');
  });

  it('falls back to empty rkey when uri has no slash', () => {
    const url = bskyPostUrl({
      author: { handle: 'h' },
      uri: 'no-slashes',
    });
    expect(url).toBe('https://bsky.app/profile/h/post/');
  });
});
