// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

const archiveShell = `<!doctype html>
<html><body>
<script type="application/json" id="inventory">
{"saves":[]}
</script>
<script type="application/json" id="local-image-paths">
{}
</script>
<script type="application/json" id="image-blobs">
{}
</script>
</body></html>`;

beforeEach(async () => {
  const { clearImageBlobs } = await import('../lib/image-store');
  await clearImageBlobs();
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(archiveShell, { status: 200 })));
});

describe('exportArchive — HTML branch (no saved blobs)', () => {
  it('returns a single .html file with the inventory injected and empty path/blob maps', async () => {
    const { exportArchive } = await import('./html-exporter');
    const inv = { saves: [{ uri: 'a', author: { did: 'd', handle: 'h' }, record: { text: 't', createdAt: '2026-05-05T00:00:00Z' } }] };
    const r = await exportArchive(inv as any);
    expect(r.filename).toBe('saves-archive.html');
    expect(r.blob.type).toBe('text/html');
    const text = await r.blob.text();
    const inv1 = /<script type="application\/json" id="inventory">([\s\S]*?)<\/script>/.exec(text);
    expect(inv1).not.toBeNull();
    expect(JSON.parse(inv1![1]).saves[0].uri).toBe('a');
    const lp = /<script type="application\/json" id="local-image-paths">([\s\S]*?)<\/script>/.exec(text);
    expect(JSON.parse(lp![1])).toEqual({});
    const ib = /<script type="application\/json" id="image-blobs">([\s\S]*?)<\/script>/.exec(text);
    expect(JSON.parse(ib![1])).toEqual({});
  });
});

describe('exportArchive — ZIP branch (saved blobs)', () => {
  it('returns a .zip with index.html, inventory.json, and images/<sha>.<ext>', async () => {
    const { saveImageBlob } = await import('../lib/image-store');
    await saveImageBlob('https://i/1', new Blob(['png-bytes'], { type: 'image/png' }));
    const { exportArchive } = await import('./html-exporter');
    const inv = { saves: [{ uri: 'a', images: [{ url: 'https://i/1' }] }] };
    const r = await exportArchive(inv as any);
    expect(r.filename).toBe('saves-archive.zip');
    expect(r.blob.type).toBe('application/zip');

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());
    expect(zip.file('index.html')).not.toBeNull();
    expect(zip.file('inventory.json')).not.toBeNull();
    const imageFiles = Object.keys(zip.files).filter((f) => f.startsWith('images/') && !zip.files[f].dir);
    expect(imageFiles.length).toBe(1);
    expect(imageFiles[0]).toMatch(/^images\/[0-9a-f]{64}\.png$/);

    const indexHtml = await zip.file('index.html')!.async('string');
    const lp = /<script type="application\/json" id="local-image-paths">([\s\S]*?)<\/script>/.exec(indexHtml);
    expect(lp).not.toBeNull();
    const map = JSON.parse(lp![1]);
    expect(map['https://i/1']).toBe(imageFiles[0]);
    const ib = /<script type="application\/json" id="image-blobs">([\s\S]*?)<\/script>/.exec(indexHtml);
    expect(JSON.parse(ib![1])).toEqual({});

    const invText = await zip.file('inventory.json')!.async('string');
    expect(JSON.parse(invText).saves[0].uri).toBe('a');
  });
});
