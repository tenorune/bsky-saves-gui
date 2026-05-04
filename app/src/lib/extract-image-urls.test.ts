import { describe, expect, it } from 'vitest';

describe('extractImageUrls', () => {
  it('returns [] for non-object inputs', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    expect(extractImageUrls(null)).toEqual([]);
    expect(extractImageUrls(undefined)).toEqual([]);
    expect(extractImageUrls('string')).toEqual([]);
    expect(extractImageUrls(42)).toEqual([]);
  });

  it('returns [] when saves is missing or not an array', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    expect(extractImageUrls({})).toEqual([]);
    expect(extractImageUrls({ saves: 'oops' })).toEqual([]);
    expect(extractImageUrls({ saves: [] })).toEqual([]);
  });

  it('collects URLs from top-level images', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        { images: [{ url: 'https://x/a.jpg' }, { url: 'https://x/b.jpg' }] },
      ],
    });
    expect(urls.sort()).toEqual(['https://x/a.jpg', 'https://x/b.jpg']);
  });

  it('collects URLs from quoted_post.images', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [{ quoted_post: { images: [{ url: 'https://x/q.jpg' }] } }],
    });
    expect(urls).toEqual(['https://x/q.jpg']);
  });

  it('collects URLs from thread_replies[i].images', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        {
          thread_replies: [
            { images: [{ url: 'https://x/t1.jpg' }] },
            { images: [{ url: 'https://x/t2.jpg' }] },
          ],
        },
      ],
    });
    expect(urls.sort()).toEqual(['https://x/t1.jpg', 'https://x/t2.jpg']);
  });

  it('collects URLs from quoted_post.thread_replies[i].images', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        {
          quoted_post: {
            thread_replies: [{ images: [{ url: 'https://x/qt.jpg' }] }],
          },
        },
      ],
    });
    expect(urls).toEqual(['https://x/qt.jpg']);
  });

  it('dedupes URLs that appear in multiple locations', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        {
          images: [{ url: 'https://x/dup.jpg' }],
          thread_replies: [{ images: [{ url: 'https://x/dup.jpg' }] }],
        },
      ],
    });
    expect(urls).toEqual(['https://x/dup.jpg']);
  });

  it('filters out non-http URLs', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [{ images: [{ url: 'data:image/png;base64,abc' }, { url: 'ftp://x/y' }] }],
    });
    expect(urls).toEqual([]);
  });

  it('ignores image entries without a string url', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [{ images: [{ alt: 'no url' }, null, 42, { url: 123 }] }],
    });
    expect(urls).toEqual([]);
  });

  it('handles a realistic inventory with all four locations populated', async () => {
    const { extractImageUrls } = await import('./extract-image-urls');
    const urls = extractImageUrls({
      saves: [
        {
          uri: 'a',
          images: [{ url: 'https://x/1' }],
          quoted_post: {
            images: [{ url: 'https://x/2' }],
            thread_replies: [{ images: [{ url: 'https://x/3' }] }],
          },
          thread_replies: [{ images: [{ url: 'https://x/4' }] }],
        },
        { uri: 'b', images: [{ url: 'https://x/5' }] },
      ],
    });
    expect(urls.sort()).toEqual([
      'https://x/1',
      'https://x/2',
      'https://x/3',
      'https://x/4',
      'https://x/5',
    ]);
  });
});
