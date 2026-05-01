import { describe, expect, it, vi, beforeEach } from 'vitest';
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
</body></html>`;

describe('htmlExporter', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/archive-template/index.html')) return new Response(archiveHtml);
        return new Response('not found', { status: 404 });
      }),
    );
  });

  it('returns a zip containing the self-contained HTML in zip mode', async () => {
    const { exportHtml } = await import('./html-exporter');
    const result = await exportHtml(inv, { mode: 'zip' });
    expect(result.filename).toBe('saves-archive.zip');
    expect(result.blob.type).toMatch(/zip/);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('returns a single self-contained HTML with inventory injected', async () => {
    const { exportHtml } = await import('./html-exporter');
    const result = await exportHtml(inv, { mode: 'self-contained' });
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

  it('throws if the shell is missing the inventory script tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html><body></body></html>')),
    );
    const { exportHtml } = await import('./html-exporter');
    await expect(exportHtml(inv, { mode: 'self-contained' })).rejects.toThrow(/inventory script tag/);
  });
});
