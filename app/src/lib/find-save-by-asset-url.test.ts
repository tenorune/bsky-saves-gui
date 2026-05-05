import { describe, expect, it } from 'vitest';
import { findSaveByAssetUrl } from './find-save-by-asset-url';

const A = { did: 'd1', handle: 'a.example' };
const REC = { text: 't', createdAt: '2026-05-05T00:00:00Z' };

function inv(saves: unknown[]): unknown {
  return { saves };
}

describe('findSaveByAssetUrl', () => {
  it('matches save.images[i].url', () => {
    const save = { uri: 'at://1', author: A, record: REC, images: [{ url: 'https://i/1' }] };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/1')).toBe(save);
  });

  it('matches save.embed.images[i].url', () => {
    const save = {
      uri: 'at://2',
      author: A,
      record: REC,
      embed: { images: [{ url: 'https://i/2' }] },
    };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/2')).toBe(save);
  });

  it('matches save.embed.url (article)', () => {
    const save = { uri: 'at://3', author: A, record: REC, embed: { url: 'https://a/3' } };
    expect(findSaveByAssetUrl(inv([save]), 'https://a/3')).toBe(save);
  });

  it('matches inside save.thread_replies[i].images[j].url', () => {
    const save = {
      uri: 'at://4',
      author: A,
      record: REC,
      thread_replies: [{ images: [{ url: 'https://i/4' }] }],
    };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/4')).toBe(save);
  });

  it('matches inside save.quoted_post.images[i].url', () => {
    const save = {
      uri: 'at://5',
      author: A,
      record: REC,
      quoted_post: { images: [{ url: 'https://i/5' }] },
    };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/5')).toBe(save);
  });

  it('matches inside save.quoted_post.thread_replies[i].images[j].url', () => {
    const save = {
      uri: 'at://6',
      author: A,
      record: REC,
      quoted_post: { thread_replies: [{ images: [{ url: 'https://i/6' }] }] },
    };
    expect(findSaveByAssetUrl(inv([save]), 'https://i/6')).toBe(save);
  });

  it('returns null when no save matches', () => {
    const save = { uri: 'at://7', author: A, record: REC, images: [{ url: 'https://i/7' }] };
    expect(findSaveByAssetUrl(inv([save]), 'https://nope/')).toBeNull();
  });

  it('returns null for null/undefined inventory', () => {
    expect(findSaveByAssetUrl(null, 'https://x/')).toBeNull();
    expect(findSaveByAssetUrl(undefined, 'https://x/')).toBeNull();
  });

  it('returns null when inventory has no saves array', () => {
    expect(findSaveByAssetUrl({}, 'https://x/')).toBeNull();
    expect(findSaveByAssetUrl({ saves: 'nope' }, 'https://x/')).toBeNull();
  });

  it('handles malformed save entries without throwing', () => {
    const inputs: unknown[] = [null, 'string', 42, {}, { embed: null }];
    expect(findSaveByAssetUrl(inv(inputs), 'https://x/')).toBeNull();
  });
});
