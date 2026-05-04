// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
});

describe('image-store', () => {
  it('round-trips a Blob keyed by URL', async () => {
    const { saveImageBlob, loadImageBlob } = await import('./image-store');
    const blob = new Blob(['hello'], { type: 'image/png' });
    await saveImageBlob('https://x/a.png', blob);
    const got = await loadImageBlob('https://x/a.png');
    expect(got).toBeDefined();
    expect(got!.type).toBe('image/png');
    expect(got!.size).toBe(5);
  });

  it('returns undefined for an unknown URL', async () => {
    const { loadImageBlob } = await import('./image-store');
    const got = await loadImageBlob('https://x/missing.png');
    expect(got).toBeUndefined();
  });

  it('hasImageBlob is true after save, false after delete', async () => {
    const { saveImageBlob, hasImageBlob, deleteImageBlob } = await import('./image-store');
    await saveImageBlob('https://x/b.png', new Blob([''], { type: 'image/png' }));
    expect(await hasImageBlob('https://x/b.png')).toBe(true);
    await deleteImageBlob('https://x/b.png');
    expect(await hasImageBlob('https://x/b.png')).toBe(false);
  });

  it('imageBlobCount reports the right number', async () => {
    const { saveImageBlob, imageBlobCount } = await import('./image-store');
    expect(await imageBlobCount()).toBe(0);
    await saveImageBlob('https://x/1', new Blob([''], { type: 'image/png' }));
    await saveImageBlob('https://x/2', new Blob([''], { type: 'image/png' }));
    expect(await imageBlobCount()).toBe(2);
  });

  it('clearImageBlobs empties the store', async () => {
    const { saveImageBlob, clearImageBlobs, imageBlobCount } = await import('./image-store');
    await saveImageBlob('https://x/a', new Blob([''], { type: 'image/png' }));
    await clearImageBlobs();
    expect(await imageBlobCount()).toBe(0);
  });
});
