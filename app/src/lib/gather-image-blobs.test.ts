// Run in Node so fake-indexeddb can round-trip Blobs (jsdom's structured-clone
// implementation loses Blob internals — see image-store.test.ts for details).
// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
});

describe('gatherImageBlobs', () => {
  it('returns an empty map when no blobs are saved', async () => {
    const { gatherImageBlobs } = await import('./gather-image-blobs');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }],
    };
    const out = await gatherImageBlobs(inv);
    expect(out).toEqual({});
  });

  it('returns base64-encoded blobs for saved URLs', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['hello'], { type: 'image/png' }));
    const { gatherImageBlobs } = await import('./gather-image-blobs');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }],
    };
    const out = await gatherImageBlobs(inv);
    expect(Object.keys(out)).toEqual(['https://i/1']);
    expect(out['https://i/1'].mime).toBe('image/png');
    // 'hello' base64 is 'aGVsbG8='
    expect(out['https://i/1'].data_b64).toBe('aGVsbG8=');
  });

  it('skips URLs without saved blobs', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['x'], { type: 'image/png' }));
    const { gatherImageBlobs } = await import('./gather-image-blobs');
    const inv = {
      saves: [
        { uri: 'a', images: [{ url: 'https://i/1' }, { url: 'https://i/2' }] },
      ],
    };
    const out = await gatherImageBlobs(inv);
    expect(Object.keys(out)).toEqual(['https://i/1']);
  });

  it('uses application/octet-stream when blob.type is empty', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['x']));
    const { gatherImageBlobs } = await import('./gather-image-blobs');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }],
    };
    const out = await gatherImageBlobs(inv);
    expect(out['https://i/1'].mime).toBe('application/octet-stream');
  });
});
