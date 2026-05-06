import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  renderStaticArchive,
  renderPostCardSummary,
  renderPostFocusContent,
  renderQuotedPost,
  renderArticleDetails,
  renderPostBody,
  renderThread,
  splitParagraphs,
  STYLES,
} from './render-static-archive';
import type { Inventory, Save } from '../reader/inventory-shape';
import type { GatheredImageFile } from '../lib/gather-image-files';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSave(overrides: Partial<Save> = {}): Save {
  return {
    uri: 'at://did:plc:abc123/app.bsky.feed.post/3testrkeyabc',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    record: { text: 'Hello world', createdAt: '2026-01-15T12:00:00Z' },
    ...overrides,
  } as Save;
}

function makeImageFile(url: string, sha = 'aabbcc', ext = 'jpg'): GatheredImageFile {
  return {
    url,
    filename: `${sha}.${ext}`,
    blob: new Blob(['img'], { type: `image/${ext}` }),
  };
}

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes & < > " and apostrophe', () => {
    expect(escapeHtml('&<>"\'')) .toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world');
  });

  it('escapes a script injection attempt', () => {
    const evil = '<script>alert("xss")</script>';
    const out = escapeHtml(evil);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

// ---------------------------------------------------------------------------
// splitParagraphs
// ---------------------------------------------------------------------------

describe('splitParagraphs', () => {
  it('splits on blank lines when present', () => {
    const result = splitParagraphs('Para one\n\nPara two');
    expect(result).toEqual(['Para one', 'Para two']);
  });

  it('falls back to single newline when no blank lines', () => {
    const result = splitParagraphs('Line one\nLine two');
    expect(result).toEqual(['Line one', 'Line two']);
  });

  it('returns empty array for empty/whitespace input', () => {
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs('   ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Single-file mode (no image files)
// ---------------------------------------------------------------------------

describe('renderStaticArchive — single-file mode (kind: html)', () => {
  it('returns kind "html" when imageFiles is empty', () => {
    const inv: Inventory = { saves: [makeSave()] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    expect(out.kind).toBe('html');
  });

  it('contains inline <style> block', () => {
    const inv: Inventory = { saves: [makeSave()] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).toContain('<style>');
  });

  it('contains the search input', () => {
    const inv: Inventory = { saves: [makeSave()] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).toContain('id="search"');
    expect(out.html).toContain('type="search"');
  });

  it('contains the vanilla-JS search script', () => {
    const inv: Inventory = { saves: [makeSave()] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).toContain('data-searchable');
    expect(out.html).toContain('addEventListener');
  });

  it('includes the post text', () => {
    const inv: Inventory = { saves: [makeSave({ record: { text: 'My unique post content', createdAt: '2026-01-15T12:00:00Z' } })] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).toContain('My unique post content');
  });

  it('includes the full post detail in single-file mode (no link to separate page)', () => {
    const inv: Inventory = { saves: [makeSave()] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    // Full detail renders the bsky.app link
    expect(out.html).toContain('View on bsky.app');
    // No link to posts/{rkey}.html
    expect(out.html).not.toContain('posts/');
  });

  it('HTML-escapes author name containing special chars', () => {
    const save = makeSave({ author: { handle: 'evil.bsky.social', displayName: '<script>XSS</script>' } });
    const inv: Inventory = { saves: [save] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).not.toContain('<script>XSS');
    expect(out.html).toContain('&lt;script&gt;XSS');
  });

  it('HTML-escapes post text containing special chars', () => {
    const save = makeSave({ record: { text: 'Say <hello> & "goodbye"', createdAt: '2026-01-15T12:00:00Z' } });
    const inv: Inventory = { saves: [save] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).not.toContain('<hello>');
    expect(out.html).toContain('&lt;hello&gt;');
    expect(out.html).toContain('&amp;');
  });

  it('data-searchable attribute is lowercased', () => {
    const save = makeSave({ author: { handle: 'Alice.bsky.social', displayName: 'Alice Smith' }, record: { text: 'UPPER CASE TEXT', createdAt: '2026-01-15T12:00:00Z' } });
    const inv: Inventory = { saves: [save] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).toContain('data-searchable="');
    // Verify the attribute content is lowercase
    const match = /data-searchable="([^"]+)"/.exec(out.html);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(match![1].toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// Multi-file mode (with image files)
// ---------------------------------------------------------------------------

describe('renderStaticArchive — multi-file mode (kind: files)', () => {
  it('returns kind "files" when imageFiles is non-empty', () => {
    const inv: Inventory = { saves: [makeSave()] };
    const imageFiles = [makeImageFile('https://cdn/img.jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    expect(out.kind).toBe('files');
  });

  it('files map contains index.html, styles.css, and per-save post pages', () => {
    const save = makeSave();
    const inv: Inventory = { saves: [save] };
    const imageFiles = [makeImageFile('https://cdn/img.jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    if (out.kind !== 'files') throw new Error('Expected files');

    expect(out.files.has('index.html')).toBe(true);
    expect(out.files.has('styles.css')).toBe(true);
    expect(out.files.has('posts/3testrkeyabc.html')).toBe(true);
  });

  it('creates one posts/*.html per save', () => {
    const saves = [
      makeSave({ uri: 'at://did:plc:abc/app.bsky.feed.post/rkey1' }),
      makeSave({ uri: 'at://did:plc:abc/app.bsky.feed.post/rkey2' }),
    ];
    const inv: Inventory = { saves };
    const imageFiles = [makeImageFile('https://cdn/img.jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    if (out.kind !== 'files') throw new Error('Expected files');

    expect(out.files.has('posts/rkey1.html')).toBe(true);
    expect(out.files.has('posts/rkey2.html')).toBe(true);
  });

  it('index.html summary cards link to posts/{rkey}.html', () => {
    const save = makeSave();
    const inv: Inventory = { saves: [save] };
    const imageFiles = [makeImageFile('https://cdn/img.jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    if (out.kind !== 'files') throw new Error('Expected files');

    const indexHtml = out.files.get('index.html')!;
    expect(indexHtml).toContain('posts/3testrkeyabc.html');
    expect(indexHtml).toContain('View post →');
  });

  it('index.html links to styles.css (not inline style)', () => {
    const inv: Inventory = { saves: [makeSave()] };
    const imageFiles = [makeImageFile('https://cdn/img.jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    if (out.kind !== 'files') throw new Error('Expected files');

    const indexHtml = out.files.get('index.html')!;
    expect(indexHtml).toContain('<link rel="stylesheet" href="styles.css">');
    expect(indexHtml).not.toContain('<style>');
  });

  it('post detail pages link to ../styles.css', () => {
    const inv: Inventory = { saves: [makeSave()] };
    const imageFiles = [makeImageFile('https://cdn/img.jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    if (out.kind !== 'files') throw new Error('Expected files');

    const postHtml = out.files.get('posts/3testrkeyabc.html')!;
    expect(postHtml).toContain('<link rel="stylesheet" href="../styles.css">');
  });

  it('post detail pages have a back link to ../index.html', () => {
    const inv: Inventory = { saves: [makeSave()] };
    const imageFiles = [makeImageFile('https://cdn/img.jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    if (out.kind !== 'files') throw new Error('Expected files');

    const postHtml = out.files.get('posts/3testrkeyabc.html')!;
    expect(postHtml).toContain('href="../index.html"');
    expect(postHtml).toContain('← Back to library');
  });

  it('data-searchable attribute is lowercased in multi-file mode', () => {
    const save = makeSave({ author: { handle: 'BOB.bsky.social', displayName: 'BOB' }, record: { text: 'HELLO', createdAt: '2026-01-15T12:00:00Z' } });
    const inv: Inventory = { saves: [save] };
    const imageFiles = [makeImageFile('https://cdn/img.jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    if (out.kind !== 'files') throw new Error('Expected files');

    const indexHtml = out.files.get('index.html')!;
    const match = /data-searchable="([^"]+)"/.exec(indexHtml);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(match![1].toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// Image src resolution
// ---------------------------------------------------------------------------

describe('image src resolution', () => {
  it('uses local path (images/{sha}.{ext}) when blob is present', () => {
    const imageUrl = 'https://cdn.bsky.app/img/photo.jpg';
    const save = makeSave({
      embed: { images: [{ fullsize: imageUrl, thumb: imageUrl, alt: 'a photo' }] },
    });
    const inv: Inventory = { saves: [save] };
    const imageFiles = [makeImageFile(imageUrl, 'deadbeef', 'jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    if (out.kind !== 'files') throw new Error('Expected files');

    const indexHtml = out.files.get('index.html')!;
    // index.html images are at images/ level (no prefix needed for index)
    const postHtml = out.files.get('posts/3testrkeyabc.html')!;
    // posts/*.html images are at ../images/ level
    expect(postHtml).toContain('src="../images/deadbeef.jpg"');
  });

  it('falls back to original CDN URL when no blob is saved', () => {
    const imageUrl = 'https://cdn.bsky.app/img/no-blob.jpg';
    const save = makeSave({
      embed: { images: [{ fullsize: imageUrl, thumb: imageUrl, alt: '' }] },
    });
    const inv: Inventory = { saves: [save] };
    // No imageFiles → single-file mode
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).toContain(`src="${imageUrl}"`);
  });
});

// ---------------------------------------------------------------------------
// Quoted post rendering
// ---------------------------------------------------------------------------

describe('renderQuotedPost', () => {
  it('renders a blockquote with handle, date, and text', () => {
    const quote = {
      text: 'A quoted post',
      created_at: '2025-11-01T00:00:00Z',
      author: { handle: 'bob.bsky.social' },
    };
    const pathMap = new Map<string, string>();
    const html = renderQuotedPost(quote, pathMap);
    expect(html).toContain('class="quoted-post"');
    expect(html).toContain('@bob.bsky.social');
    expect(html).toContain('A quoted post');
    expect(html).toContain('2025-11-01');
  });

  it('escapes HTML in quoted post text', () => {
    const quote = {
      text: '<img src=x onerror=alert(1)>',
      created_at: '',
      author: null,
    };
    const html = renderQuotedPost(quote, new Map());
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('returns empty string when quote has no content', () => {
    const html = renderQuotedPost({}, new Map());
    expect(html).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Article accordion rendering
// ---------------------------------------------------------------------------

describe('renderArticleDetails', () => {
  it('renders a <details> accordion when article.text is present', () => {
    const save = makeSave({ article: { url: 'https://example.com', text: 'Article paragraph one\n\nParagraph two' } });
    const html = renderArticleDetails(save);
    expect(html).toContain('<details class="post-body__article">');
    expect(html).toContain('View backed-up article text');
    expect(html).toContain('Article paragraph one');
    expect(html).toContain('Paragraph two');
  });

  it('returns empty string when article is absent', () => {
    const save = makeSave();
    expect(renderArticleDetails(save)).toBe('');
  });

  it('escapes HTML in article text', () => {
    const save = makeSave({ article: { url: '', text: '<b>bold</b>' } });
    const html = renderArticleDetails(save);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

// ---------------------------------------------------------------------------
// Thread rendering
// ---------------------------------------------------------------------------

describe('renderThread', () => {
  it('renders a thread section when thread entries exist', () => {
    const save = makeSave({
      thread: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/reply1',
          author: { handle: 'alice.bsky.social', displayName: 'Alice' },
          record: { text: 'Thread reply text', createdAt: '2026-01-15T13:00:00Z' },
        },
      ],
    });
    const html = renderThread(save.thread, new Map());
    expect(html).toContain('class="post-focus__thread"');
    expect(html).toContain('Thread reply text');
    expect(html).toContain('<section');
  });

  it('returns empty string when thread is empty', () => {
    expect(renderThread([], new Map())).toBe('');
    expect(renderThread(undefined, new Map())).toBe('');
  });

  it('escapes HTML in thread text', () => {
    const thread = [
      {
        uri: 'at://x',
        author: { handle: 'x' },
        record: { text: '<evil>', createdAt: '' },
      },
    ] as Save['thread'];
    const html = renderThread(thread, new Map());
    expect(html).not.toContain('<evil>');
    expect(html).toContain('&lt;evil&gt;');
  });
});

// ---------------------------------------------------------------------------
// Full integration: quoted_post rendered in page
// ---------------------------------------------------------------------------

describe('integration: posts with quoted_post', () => {
  it('renders a nested blockquote in single-file mode', () => {
    const save = makeSave({
      quoted_post: {
        text: 'Original post being quoted',
        created_at: '2025-12-01T00:00:00Z',
        author: { handle: 'charlie.bsky.social' },
      },
    } as unknown as Partial<Save>);
    const inv: Inventory = { saves: [save] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).toContain('class="quoted-post"');
    expect(out.html).toContain('Original post being quoted');
    expect(out.html).toContain('@charlie.bsky.social');
  });
});

// ---------------------------------------------------------------------------
// Integration: posts with article text
// ---------------------------------------------------------------------------

describe('integration: posts with article.text', () => {
  it('renders the <details> accordion in single-file mode', () => {
    const save = makeSave({
      article: { url: 'https://example.com/article', text: 'Long article content here\n\nSecond paragraph' },
    });
    const inv: Inventory = { saves: [save] };
    const out = renderStaticArchive({ inventory: inv, imageFiles: [] });
    if (out.kind !== 'html') throw new Error('Expected html');
    expect(out.html).toContain('<details class="post-body__article">');
    expect(out.html).toContain('Long article content here');
    expect(out.html).toContain('Second paragraph');
  });
});

// ---------------------------------------------------------------------------
// Integration: posts with thread
// ---------------------------------------------------------------------------

describe('integration: posts with thread', () => {
  it('renders the thread section in multi-file post page', () => {
    const save = makeSave({
      thread: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/threadreply',
          author: { handle: 'alice.bsky.social', displayName: 'Alice' },
          record: { text: 'Self-thread continuation', createdAt: '2026-01-15T12:30:00Z' },
        },
      ],
    });
    const inv: Inventory = { saves: [save] };
    const imageFiles = [makeImageFile('https://cdn/img.jpg')];
    const out = renderStaticArchive({ inventory: inv, imageFiles });
    if (out.kind !== 'files') throw new Error('Expected files');

    const postHtml = out.files.get('posts/3testrkeyabc.html')!;
    expect(postHtml).toContain('class="post-focus__thread"');
    expect(postHtml).toContain('Self-thread continuation');
  });
});

// ---------------------------------------------------------------------------
// STYLES constant
// ---------------------------------------------------------------------------

describe('STYLES', () => {
  it('contains key class names', () => {
    expect(STYLES).toContain('.post-card');
    expect(STYLES).toContain('.post-focus');
    expect(STYLES).toContain('.post-body__text');
    expect(STYLES).toContain('.quoted-post');
    expect(STYLES).toContain('.search-input');
  });
});
