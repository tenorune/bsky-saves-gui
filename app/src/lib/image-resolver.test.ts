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

  it('uses an embedded blob (data URI) when one is registered for the URL', async () => {
    const { registerEmbeddedBlobs, resolveImageSrc, clearEmbeddedBlobs } = await import('./image-resolver');
    registerEmbeddedBlobs({
      'https://i/embedded': { mime: 'image/png', data_b64: 'aGVsbG8=' },
    });
    try {
      const r = await resolveImageSrc('https://i/embedded');
      expect(r.src).toBe('data:image/png;base64,aGVsbG8=');
      expect(r.isBlob).toBe(false);
    } finally {
      clearEmbeddedBlobs();
    }
  });

  it('falls back to IDB then remote when no embedded blob is registered', async () => {
    const { resolveImageSrc, clearEmbeddedBlobs } = await import('./image-resolver');
    clearEmbeddedBlobs();
    const r = await resolveImageSrc('https://i/not-embedded');
    expect(r.src).toBe('https://i/not-embedded');
    expect(r.isBlob).toBe(false);
  });

  it('uses a registered local path (relative URL) when present for the URL', async () => {
    const { registerLocalImagePaths, resolveImageSrc, clearLocalImagePaths, clearEmbeddedBlobs } = await import('./image-resolver');
    clearEmbeddedBlobs();
    registerLocalImagePaths({
      'https://i/local': 'images/abc.png',
    });
    try {
      const r = await resolveImageSrc('https://i/local');
      expect(r.src).toBe('images/abc.png');
      expect(r.isBlob).toBe(false);
    } finally {
      clearLocalImagePaths();
    }
  });

  it('local paths take precedence over embedded blobs', async () => {
    const { registerLocalImagePaths, registerEmbeddedBlobs, resolveImageSrc, clearLocalImagePaths, clearEmbeddedBlobs } = await import('./image-resolver');
    registerEmbeddedBlobs({ 'https://i/both': { mime: 'image/png', data_b64: 'aGVsbG8=' } });
    registerLocalImagePaths({ 'https://i/both': 'images/zzz.png' });
    try {
      const r = await resolveImageSrc('https://i/both');
      expect(r.src).toBe('images/zzz.png');
    } finally {
      clearEmbeddedBlobs();
      clearLocalImagePaths();
    }
  });
});
