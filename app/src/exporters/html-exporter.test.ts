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

const archiveHtml = `<!doctype html>
<html><head><title>Archive</title>
<script type="module" crossorigin src="/archive-template/assets/archive-abc.js"></script>
<link rel="stylesheet" crossorigin href="/archive-template/assets/archive-def.css">
</head><body>
<div id="archive"></div>
<script type="application/json" id="inventory">
{"saves":[]}
</script>
</body></html>`;

const archiveJs = 'console.log("archive js");';
const archiveCss = '.archive{}';

describe('htmlExporter', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/archive-template/index.html')) return new Response(archiveHtml);
        if (url.endsWith('/archive-template/assets/archive-abc.js')) return new Response(archiveJs);
        if (url.endsWith('/archive-template/assets/archive-def.css'))
          return new Response(archiveCss);
        return new Response('not found', { status: 404 });
      }),
    );
  });

  it('returns a multi-file zip in zip mode with inventory injected', async () => {
    const { exportHtml } = await import('./html-exporter');
    const result = await exportHtml(inv, { mode: 'zip' });
    expect(result.filename).toBe('saves-archive.zip');
    expect(result.blob.type).toMatch(/zip/);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('returns a single self-contained HTML in self-contained mode', async () => {
    const { exportHtml } = await import('./html-exporter');
    const result = await exportHtml(inv, { mode: 'self-contained' });
    expect(result.filename).toBe('saves-archive.html');
    expect(result.blob.type).toBe('text/html');
    const text = await result.blob.text();
    // Inventory present
    expect(text).toContain('"h.example"');
    // JS inlined
    expect(text).toContain('console.log("archive js")');
    // CSS inlined
    expect(text).toContain('.archive{}');
    // No external script/link references remain
    expect(text).not.toMatch(/<script[^>]*src=/);
    expect(text).not.toMatch(/<link[^>]*href=/);
  });
});
