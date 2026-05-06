// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
});

describe('gatherImageFiles', () => {
  it('returns an empty array when no blobs are saved', async () => {
    const { gatherImageFiles } = await import('./gather-image-files');
    const inv = { saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }] };
    expect(await gatherImageFiles(inv)).toEqual([]);
  });

  it('returns one entry per saved URL with SHA-256 hex filenames and correct extensions', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['png-bytes'], { type: 'image/png' }));
    await saveImageBlob('https://i/2', new Blob(['jpg-bytes'], { type: 'image/jpeg' }));
    const { gatherImageFiles } = await import('./gather-image-files');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }, { url: 'https://i/2' }] }],
    };
    const out = await gatherImageFiles(inv);
    expect(out.length).toBe(2);
    const byUrl = new Map(out.map((e) => [e.url, e] as const));
    const e1 = byUrl.get('https://i/1');
    expect(e1).toBeDefined();
    expect(e1!.filename).toMatch(/^[0-9a-f]{64}\.png$/);
    const e2 = byUrl.get('https://i/2');
    expect(e2).toBeDefined();
    expect(e2!.filename).toMatch(/^[0-9a-f]{64}\.jpg$/);
  });

  it('produces stable filenames across calls (same URL → same filename)', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/stable', new Blob(['x'], { type: 'image/png' }));
    const { gatherImageFiles } = await import('./gather-image-files');
    const inv = { saves: [{ uri: 'a', images: [{ url: 'https://i/stable' }] }] };
    const a = await gatherImageFiles(inv);
    const b = await gatherImageFiles(inv);
    expect(a[0].filename).toBe(b[0].filename);
  });

  it('skips URLs without a saved blob', async () => {
    const { saveImageBlob } = await import('./image-store');
    await saveImageBlob('https://i/1', new Blob(['x'], { type: 'image/png' }));
    const { gatherImageFiles } = await import('./gather-image-files');
    const inv = {
      saves: [{ uri: 'a', images: [{ url: 'https://i/1' }, { url: 'https://i/missing' }] }],
    };
    const out = await gatherImageFiles(inv);
    expect(out.map((e) => e.url)).toEqual(['https://i/1']);
  });
});
