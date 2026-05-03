import { describe, expect, it } from 'vitest';
import type { Inventory } from '../reader/inventory-shape';

const sample: Inventory = {
  saves: [
    {
      uri: 'at://did:plc:abc/app.bsky.feed.post/3l00',
      cid: 'c',
      author: { did: 'd', handle: 'alice.bsky.social', displayName: 'Alice' },
      record: { text: 'first post', createdAt: '2026-04-01T12:00:00Z' },
      indexedAt: '2026-04-01T12:00:00Z',
    },
    {
      uri: 'at://did:plc:abc/app.bsky.feed.post/3l01',
      cid: 'c',
      author: { did: 'd', handle: 'bob.example' },
      record: { text: 'second post', createdAt: '2026-05-01T12:00:00Z' },
      indexedAt: '2026-05-01T12:00:00Z',
    },
  ],
};

describe('markdownExporter', () => {
  it('emits a flat reverse-chronological document with a plain-text metadata header', async () => {
    const { exportMarkdown } = await import('./markdown-exporter');
    const result = await exportMarkdown(sample, {
      account: 'me.bsky.social',
      hydratedFlags: { enrich: true, threads: false, articles: false, images: false },
    });
    const md = await result.blob.text();
    expect(result.filename).toBe('saves.md');
    // Plain bullet-list metadata, NOT YAML frontmatter.
    expect(md).not.toMatch(/^---\n/);
    expect(md).toMatch(/^- \*\*Exported:\*\*/);
    expect(md).toContain('- **Account:** @me.bsky.social');
    expect(md).toContain('- **Count:** 2');
    expect(md).toContain('- **Hydrated:** enrich');
    // Reverse-chronological order: bob (2026-05) before alice (2026-04)
    const bobIdx = md.indexOf('bob.example');
    const aliceIdx = md.indexOf('alice.bsky.social');
    expect(bobIdx).toBeGreaterThan(0);
    expect(aliceIdx).toBeGreaterThan(bobIdx);
    expect(md).toContain('## 2026-05-01 · @bob.example');
    expect(md).toContain('## 2026-04-01 · @alice.bsky.social');
    expect(md).toContain('https://bsky.app/profile/');
  });

  it('summarises hydrated flags compactly', async () => {
    const { exportMarkdown } = await import('./markdown-exporter');
    const noneResult = await exportMarkdown(sample, {
      account: 'a',
      hydratedFlags: { enrich: false, threads: false, articles: false, images: false },
    });
    expect(await noneResult.blob.text()).toContain('- **Hydrated:** none');

    const manyResult = await exportMarkdown(sample, {
      account: 'a',
      hydratedFlags: { enrich: true, threads: true, articles: false, images: true },
    });
    expect(await manyResult.blob.text()).toContain('- **Hydrated:** enrich, threads, images');
  });

  it('inlines hydrated article text under a Linked article subhead', async () => {
    const { exportMarkdown } = await import('./markdown-exporter');
    const inv: Inventory = {
      saves: [
        {
          uri: 'at://x/y/3l',
          cid: 'c',
          author: { did: 'd', handle: 'h.example' },
          record: { text: 'check this', createdAt: '2026-04-01T00:00:00Z' },
          indexedAt: '2026-04-01T00:00:00Z',
          article: {
            url: 'https://example.com/post',
            title: 'A great post',
            text: 'Body of the linked article.',
          },
        },
      ],
    };
    const result = await exportMarkdown(inv, {
      account: 'me',
      hydratedFlags: { enrich: false, threads: false, articles: true, images: false },
    });
    const md = await result.blob.text();
    expect(md).toContain('### Linked article: A great post');
    expect(md).toContain('Body of the linked article.');
  });

  it('keeps multi-paragraph thread replies inside one blockquote', async () => {
    const { exportMarkdown } = await import('./markdown-exporter');
    const inv: Inventory = {
      saves: [
        {
          uri: 'at://x/y/3l',
          cid: 'c',
          author: { did: 'd', handle: 'a.example' },
          record: { text: 'parent', createdAt: '2026-04-01T00:00:00Z' },
          indexedAt: '2026-04-01T00:00:00Z',
          thread: [
            {
              uri: 'at://x/y/r1',
              author: { did: 'd', handle: 'a.example' },
              record: { text: 'para 1\n\npara 2\n\npara 3', createdAt: '2026-04-01T00:00:01Z' },
            },
            {
              uri: 'at://x/y/r2',
              author: { did: 'd', handle: 'a.example' },
              record: { text: 'next reply', createdAt: '2026-04-01T00:00:02Z' },
            },
          ],
        },
      ],
    };
    const result = await exportMarkdown(inv, {
      account: 'me',
      hydratedFlags: { enrich: false, threads: true, articles: false, images: false },
    });
    const md = await result.blob.text();
    // Every line of the multi-paragraph reply, including blanks between
    // paragraphs, must carry a `>` so it stays in one blockquote.
    expect(md).toContain('> @a.example: para 1\n>\n> para 2\n>\n> para 3');
    expect(md).toContain('> @a.example: next reply');
  });
});
