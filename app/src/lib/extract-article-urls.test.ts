import { describe, expect, it } from 'vitest';

describe('extractArticleUrls', () => {
  it('returns [] for non-object inputs', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    expect(extractArticleUrls(null)).toEqual([]);
    expect(extractArticleUrls(undefined)).toEqual([]);
    expect(extractArticleUrls('string')).toEqual([]);
  });

  it('returns [] when saves is missing or not an array', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    expect(extractArticleUrls({})).toEqual([]);
    expect(extractArticleUrls({ saves: 'oops' })).toEqual([]);
    expect(extractArticleUrls({ saves: [] })).toEqual([]);
  });

  it('collects URLs from save.embed.url', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [
        { embed: { url: 'https://example.com/a' } },
        { embed: { url: 'https://example.com/b' } },
      ],
    });
    expect(urls.sort()).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('skips saves whose article is already hydrated (article_text present)', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [
        { embed: { url: 'https://example.com/a' }, article_text: 'already done' },
        { embed: { url: 'https://example.com/b' } },
      ],
    });
    expect(urls).toEqual(['https://example.com/b']);
  });

  it('dedupes URLs that appear in multiple saves', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [
        { embed: { url: 'https://example.com/x' } },
        { embed: { url: 'https://example.com/x' } },
      ],
    });
    expect(urls).toEqual(['https://example.com/x']);
  });

  it('filters out non-http URLs', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [{ embed: { url: 'data:text/plain,foo' } }, { embed: { url: 'mailto:a@b' } }],
    });
    expect(urls).toEqual([]);
  });

  it('ignores saves without an embed object', async () => {
    const { extractArticleUrls } = await import('./extract-article-urls');
    const urls = extractArticleUrls({
      saves: [
        { uri: 'a' }, // no embed
        { embed: null },
        { embed: 'oops' },
        { embed: { url: 'https://x/ok' } },
      ],
    });
    expect(urls).toEqual(['https://x/ok']);
  });
});
