import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  const { clearImageBlobs } = await import('./image-store');
  await clearImageBlobs();
});

describe('extractImageUrls', () => {
  it('collects URLs from top-level images, quoted_post.images, and thread_replies', async () => {
    const { extractImageUrls } = await import('./image-hydrator');
    const inv = {
      saves: [
        {
          uri: 'a',
          images: [{ url: 'https://x/a.jpg' }, { url: 'https://x/b.jpg' }],
          quoted_post: { images: [{ url: 'https://x/q.jpg' }] },
          thread_replies: [
            { images: [{ url: 'https://x/t1.jpg' }] },
            { images: [{ url: 'https://x/a.jpg' }] }, // dup
          ],
        },
      ],
    };
    const urls = extractImageUrls(inv);
    expect(urls.sort()).toEqual([
      'https://x/a.jpg',
      'https://x/b.jpg',
      'https://x/q.jpg',
      'https://x/t1.jpg',
    ]);
  });

  it('ignores non-http URLs and missing fields', async () => {
    const { extractImageUrls } = await import('./image-hydrator');
    const inv = { saves: [{ images: [{ url: 'data:foo' }, { alt: 'no url' }] }] };
    expect(extractImageUrls(inv)).toEqual([]);
  });
});

describe('hydrateImages', () => {
  it('fetches every URL once, stores blobs, and tags saves with local_images', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      blob: async () => new Blob([url], { type: 'image/png' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { hydrateImages } = await import('./image-hydrator');
    const { hasImageBlob, loadImageBlob } = await import('./image-store');
    const inv = {
      saves: [
        {
          uri: 'a',
          images: [{ url: 'https://x/1.png' }],
          thread_replies: [{ images: [{ url: 'https://x/2.png' }] }],
        },
        { uri: 'b' },
      ],
    };

    const { result } = await hydrateImages(inv);
    expect(result).toEqual({ fetched: 2, skipped: 0, failed: 0 });
    expect(await hasImageBlob('https://x/1.png')).toBe(true);
    expect(await hasImageBlob('https://x/2.png')).toBe(true);

    const blob = await loadImageBlob('https://x/1.png');
    expect(blob).toBeDefined();

    const tagged = (inv.saves[0] as { local_images?: { url: string }[] }).local_images;
    expect(tagged).toBeDefined();
    expect(tagged!.map((i) => i.url).sort()).toEqual(['https://x/1.png', 'https://x/2.png']);
    // Save with no images stays untagged.
    expect((inv.saves[1] as { local_images?: unknown }).local_images).toBeUndefined();

    // Re-running skips already-cached URLs.
    fetchMock.mockClear();
    const second = await hydrateImages(inv);
    expect(second.result).toEqual({ fetched: 0, skipped: 2, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks failures and does NOT tag the save as hydrated for failed URLs only', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('bad.png')) return { ok: false, status: 500, blob: async () => new Blob() };
      return { ok: true, blob: async () => new Blob(['ok'], { type: 'image/png' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { hydrateImages } = await import('./image-hydrator');
    const inv = {
      saves: [
        { uri: 'a', images: [{ url: 'https://x/good.png' }, { url: 'https://x/bad.png' }] },
      ],
    };
    const { result } = await hydrateImages(inv);
    expect(result.fetched).toBe(1);
    expect(result.failed).toBe(1);
    const tagged = (inv.saves[0] as { local_images?: { url: string }[] }).local_images;
    expect(tagged?.map((i) => i.url)).toEqual(['https://x/good.png']);
  });
});
