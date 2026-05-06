// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import type { Inventory } from '../reader/inventory-shape';

const inv: Inventory = {
  saves: [
    {
      uri: 'at://x/y/1',
      cid: 'c',
      author: { did: 'd', handle: 'h.example' },
      record: { text: 't', createdAt: '2026-04-01T00:00:00Z' },
      indexedAt: '2026-04-01T00:00:00Z',
    },
  ],
};

// The archive template is now built as a single self-contained HTML by
// vite-plugin-singlefile, so the html-exporter just fetches that one file
// and injects the inventory script. Simulate that.
const archiveHtml = `<!doctype html>
<html><head><title>Archive</title>
<script type="module">console.log("archive js");</script>
<style>.archive{}</style>
</head><body>
<div id="archive"></div>
<script type="application/json" id="inventory">
{"saves":[]}
</script>
<script type="application/json" id="image-blobs">
{}
</script>
</body></html>`;

describe('htmlExporter', () => {
  beforeEach(async () => {
    const { clearImageBlobs } = await import('../lib/image-store');
    await clearImageBlobs();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/archive-template/index.html')) return new Response(archiveHtml);
        return new Response('not found', { status: 404 });
      }),
    );
  });

  it('returns a single self-contained HTML with inventory injected', async () => {
    const { exportHtml } = await import('./html-exporter');
    const result = await exportHtml(inv);
    expect(result.filename).toBe('saves-archive.html');
    expect(result.blob.type).toBe('text/html');
    const text = await result.blob.text();
    // Inventory injected.
    expect(text).toContain('"h.example"');
    // Inlined JS and CSS are still present (they came from the shell).
    expect(text).toContain('console.log("archive js")');
    expect(text).toContain('.archive{}');
    // The placeholder empty inventory was replaced.
    expect(text).not.toContain('"saves":[]');
  });

  it('preserves $-tokens in post text without backreference corruption', async () => {
    const trickyInv: Inventory = {
      saves: [
        {
          uri: 'at://x/y/1',
          cid: 'c',
          author: { did: 'd', handle: 'h.example' },
          record: {
            // $1, $&, $$ would all be expanded by String.replace's replacement
            // string if we used the literal-string form by mistake.
            text: 'price is $1 and also $& and $$ and $`backtick` and $\'apostrophe\'',
            createdAt: '2026-04-01T00:00:00Z',
          },
          indexedAt: '2026-04-01T00:00:00Z',
        },
      ],
    };
    const { exportHtml } = await import('./html-exporter');
    const result = await exportHtml(trickyInv);
    const text = await result.blob.text();
    // Pull out the inlined inventory JSON and round-trip through JSON.parse to
    // confirm it survived intact.
    const m = /<script type="application\/json" id="inventory">([\s\S]*?)<\/script>/.exec(text);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1].trim());
    expect(parsed.saves[0].record.text).toBe(trickyInv.saves[0].record.text);
  });

  it('throws if the shell is missing the inventory script tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html><body></body></html>')),
    );
    const { exportHtml } = await import('./html-exporter');
    await expect(exportHtml(inv)).rejects.toThrow(/inventory script tag/);
  });

  it('injects the gathered image-blob map into the image-blobs script tag', async () => {
    const { saveImageBlob } = await import('../lib/image-store');
    await saveImageBlob('https://i/1', new Blob(['hi'], { type: 'image/png' }));

    // Replace global fetch with one that returns the test shell containing
    // both script tags. Match the shape used in the existing test for
    // injecting the inventory.
    const shellHtml = `<!doctype html>
<html><body>
<script type="application/json" id="inventory">
{"saves":[]}
</script>
<script type="application/json" id="image-blobs">
{}
</script>
</body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(shellHtml, { status: 200 })));
    try {
      const { exportHtml } = await import('./html-exporter');
      const inv = {
        saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }],
      };
      const r = await exportHtml(inv as any);
      const text = await r.blob.text();
      const m = /<script type="application\/json" id="image-blobs">([\s\S]*?)<\/script>/.exec(text);
      expect(m).not.toBeNull();
      const parsed = JSON.parse(m![1]);
      expect(parsed['https://i/1']).toBeDefined();
      expect(parsed['https://i/1'].mime).toBe('image/png');
      expect(parsed['https://i/1'].data_b64).toBe('aGk=');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
