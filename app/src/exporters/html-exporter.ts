import type { Inventory } from '../reader/inventory-shape';

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

/**
 * Build either a single-file HTML archive (when no image blobs are saved) or
 * a ZIP archive containing index.html + per-post pages + styles.css + images/
 * (when blobs exist). The HTML is pre-rendered static markup — no Svelte
 * runtime, no JS modules, no inventory.json.
 *
 * The renderer, blob-gatherer, and JSZip are dynamically imported so they
 * only load when the user actually triggers an export.
 */
export async function exportArchive(inventory: Inventory): Promise<ExportResult> {
  const [{ gatherImageFiles }, { renderStaticArchive }] = await Promise.all([
    import('../lib/gather-image-files'),
    import('./render-static-archive'),
  ]);
  const imageFiles = await gatherImageFiles(inventory);
  const out = renderStaticArchive({ inventory, imageFiles });

  if (out.kind === 'html') {
    return {
      blob: new Blob([out.html], { type: 'text/html' }),
      filename: 'saves-archive.html',
    };
  }

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [path, content] of out.files) {
    zip.file(path, content);
  }
  const imagesDir = zip.folder('images')!;
  for (const f of imageFiles) {
    imagesDir.file(f.filename, await f.blob.arrayBuffer());
  }

  const zipBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  return { blob: zipBlob, filename: 'saves-archive.zip' };
}

// Backwards-compatible export name kept for any in-flight callers.
export { exportArchive as exportHtml };
