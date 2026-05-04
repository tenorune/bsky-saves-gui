import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
  vi.unstubAllGlobals();
});

describe('resolveImageSrc', () => {
  it('returns the remote URL when no blob is cached', async () => {
    const { resolveImageSrc } = await import('./image-resolver');
    const result = await resolveImageSrc('https://cdn.bsky.app/img/foo.jpg');
    expect(result).toEqual({
      src: 'https://cdn.bsky.app/img/foo.jpg',
      isBlob: false,
    });
  });

  it('returns a blob URL when the blob is cached', async () => {
    // Stub URL.createObjectURL since fake-indexeddb's blob support varies.
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    vi.stubGlobal('URL', { ...URL, createObjectURL });

    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://cdn.bsky.app/img/foo.jpg', new Blob(['IMG'], { type: 'image/png' }));

    const { resolveImageSrc } = await import('./image-resolver');
    const result = await resolveImageSrc('https://cdn.bsky.app/img/foo.jpg');
    expect(result).toEqual({
      src: 'blob:fake-url',
      isBlob: true,
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('falls back to the remote URL when the IDB lookup throws', async () => {
    // Force loadImageBlob to throw by mocking the module.
    vi.doMock('./image-store', () => ({
      loadImageBlob: vi.fn(async () => {
        throw new Error('IDB unavailable');
      }),
    }));
    const { resolveImageSrc } = await import('./image-resolver');
    const result = await resolveImageSrc('https://cdn.bsky.app/img/foo.jpg');
    expect(result).toEqual({
      src: 'https://cdn.bsky.app/img/foo.jpg',
      isBlob: false,
    });
    vi.doUnmock('./image-store');
  });
});
