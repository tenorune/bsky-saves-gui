// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearImageBlobs } = await import('../lib/image-store');
  await clearImageBlobs();
});

describe('exportArchive — HTML branch (no saved blobs)', () => {
  it('returns filename saves-archive.html and type text/html', async () => {
    const { exportArchive } = await import('./html-exporter');
    const inv = {
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey1',
          author: { handle: 'alice.bsky.social', displayName: 'Alice' },
          record: { text: 'Hello from the test', createdAt: '2026-01-15T12:00:00Z' },
        },
      ],
    };
    const r = await exportArchive(inv as any);
    expect(r.filename).toBe('saves-archive.html');
    expect(r.blob.type).toBe('text/html');
  });

  it('body contains the post text', async () => {
    const { exportArchive } = await import('./html-exporter');
    const inv = {
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey2',
          author: { handle: 'alice.bsky.social', displayName: 'Alice' },
          record: { text: 'Unique content xyz987', createdAt: '2026-01-15T12:00:00Z' },
        },
      ],
    };
    const r = await exportArchive(inv as any);
    const text = await r.blob.text();
    expect(text).toContain('Unique content xyz987');
  });

  it('body contains the search input', async () => {
    const { exportArchive } = await import('./html-exporter');
    const inv = {
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey3',
          author: { handle: 'bob.bsky.social', displayName: 'Bob' },
          record: { text: 'Another post', createdAt: '2026-01-15T12:00:00Z' },
        },
      ],
    };
    const r = await exportArchive(inv as any);
    const text = await r.blob.text();
    expect(text).toContain('id="search"');
    expect(text).toContain('type="search"');
  });

  it('is a self-contained single HTML file (no link to posts/ or styles.css)', async () => {
    const { exportArchive } = await import('./html-exporter');
    const inv = {
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey4',
          author: { handle: 'carol.bsky.social', displayName: 'Carol' },
          record: { text: 'Self-contained test', createdAt: '2026-01-15T12:00:00Z' },
        },
      ],
    };
    const r = await exportArchive(inv as any);
    const text = await r.blob.text();
    // Should have inline styles, not a link to stylesheet
    expect(text).toContain('<style>');
    expect(text).not.toContain('href="styles.css"');
    // No links to separate post pages
    expect(text).not.toContain('posts/rkey4.html');
  });
});

describe('exportArchive — ZIP branch (saved blobs)', () => {
  it('returns filename saves-archive.zip and type application/zip', async () => {
    const { saveImageBlob } = await import('../lib/image-store');
    await saveImageBlob('https://i/img1.png', new Blob(['png-bytes'], { type: 'image/png' }));
    const { exportArchive } = await import('./html-exporter');
    const inv = {
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey10',
          author: { handle: 'alice.bsky.social', displayName: 'Alice' },
          record: { text: 'Post with image', createdAt: '2026-01-15T12:00:00Z' },
          images: [{ url: 'https://i/img1.png' }],
        },
      ],
    };
    const r = await exportArchive(inv as any);
    expect(r.filename).toBe('saves-archive.zip');
    expect(r.blob.type).toBe('application/zip');
  });

  it('ZIP contains index.html, styles.css, and posts/{rkey}.html', async () => {
    const { saveImageBlob } = await import('../lib/image-store');
    await saveImageBlob('https://i/img2.png', new Blob(['png-bytes'], { type: 'image/png' }));
    const { exportArchive } = await import('./html-exporter');
    const inv = {
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey11',
          author: { handle: 'alice.bsky.social', displayName: 'Alice' },
          record: { text: 'Post with image', createdAt: '2026-01-15T12:00:00Z' },
          images: [{ url: 'https://i/img2.png' }],
        },
      ],
    };
    const r = await exportArchive(inv as any);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());

    expect(zip.file('index.html')).not.toBeNull();
    expect(zip.file('styles.css')).not.toBeNull();
    expect(zip.file('posts/rkey11.html')).not.toBeNull();
  });

  it('ZIP contains images/{sha}.png for the saved blob', async () => {
    const { saveImageBlob } = await import('../lib/image-store');
    await saveImageBlob('https://i/img3.png', new Blob(['png-bytes'], { type: 'image/png' }));
    const { exportArchive } = await import('./html-exporter');
    const inv = {
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey12',
          author: { handle: 'alice.bsky.social', displayName: 'Alice' },
          record: { text: 'Post with image', createdAt: '2026-01-15T12:00:00Z' },
          images: [{ url: 'https://i/img3.png' }],
        },
      ],
    };
    const r = await exportArchive(inv as any);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());

    const imageFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('images/') && !zip.files[f].dir,
    );
    expect(imageFiles.length).toBe(1);
    expect(imageFiles[0]).toMatch(/^images\/[0-9a-f]{64}\.png$/);
  });

  it('posts/{rkey}.html references the local image path ../images/{sha}.png', async () => {
    const { saveImageBlob } = await import('../lib/image-store');
    await saveImageBlob('https://i/img4.png', new Blob(['png-bytes'], { type: 'image/png' }));
    const { exportArchive } = await import('./html-exporter');
    const inv = {
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey13',
          author: { handle: 'alice.bsky.social', displayName: 'Alice' },
          record: { text: 'Post with image', createdAt: '2026-01-15T12:00:00Z' },
          images: [{ url: 'https://i/img4.png' }],
        },
      ],
    };
    const r = await exportArchive(inv as any);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());

    const imageFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('images/') && !zip.files[f].dir,
    );
    const imageFilename = imageFiles[0].replace('images/', ''); // e.g. "abc...def.png"

    const postHtml = await zip.file('posts/rkey13.html')!.async('string');
    expect(postHtml).toContain(`src="../images/${imageFilename}"`);
  });

  it('fetch is not called (no archive shell template needed)', async () => {
    // In the new exporter, fetch is never called. This test confirms the
    // exporter works fine without any fetch stub.
    const { saveImageBlob } = await import('../lib/image-store');
    await saveImageBlob('https://i/img5.png', new Blob(['x'], { type: 'image/png' }));
    const { exportArchive } = await import('./html-exporter');
    const inv = {
      saves: [
        {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rkey14',
          author: { handle: 'alice.bsky.social', displayName: 'Alice' },
          record: { text: 'No fetch needed', createdAt: '2026-01-15T12:00:00Z' },
          images: [{ url: 'https://i/img5.png' }],
        },
      ],
    };
    // No vi.stubGlobal('fetch', ...) — if fetch were called, this would throw
    // in the Node environment because global.fetch may not exist.
    const r = await exportArchive(inv as any);
    expect(r.filename).toBe('saves-archive.zip');
  });
});
