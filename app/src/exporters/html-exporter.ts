import JSZip from 'jszip';
import type { Inventory } from '../reader/inventory-shape';
import { gatherImageFiles, type GatheredImageFile } from '../lib/gather-image-files';

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

const ARCHIVE_URL = '/archive-template/index.html';
const INVENTORY_RE = /(<script type="application\/json" id="inventory">)[\s\S]*?(<\/script>)/;
const LOCAL_PATHS_RE = /(<script type="application\/json" id="local-image-paths">)[\s\S]*?(<\/script>)/;
const IMAGE_BLOBS_RE = /(<script type="application\/json" id="image-blobs">)[\s\S]*?(<\/script>)/;

function escapeForScript(json: string): string {
  return json.replace(/<\/script/gi, '<\\/script');
}

function injectScript(re: RegExp, html: string, payload: unknown, label: string): string {
  if (!re.test(html)) {
    throw new Error(`Archive shell missing ${label} script tag`);
  }
  const json = escapeForScript(JSON.stringify(payload));
  return html.replace(re, (_match, openTag, closeTag) => `${openTag}\n${json}\n${closeTag}`);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

function localPathsMap(files: readonly GatheredImageFile[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) out[f.url] = `images/${f.filename}`;
  return out;
}

/**
 * Build either a single-file HTML archive (when no image blobs are saved) or
 * a ZIP archive containing a lean HTML shell plus `inventory.json` plus an
 * `images/` directory (when blobs exist). The HTML's image-resolver registers
 * the appropriate script tag at load time so images render in either form.
 */
export async function exportArchive(inventory: Inventory): Promise<ExportResult> {
  const shell = await fetchText(ARCHIVE_URL);
  const files = await gatherImageFiles(inventory);

  if (files.length === 0) {
    let html = shell;
    html = injectScript(INVENTORY_RE, html, inventory, 'inventory');
    html = injectScript(LOCAL_PATHS_RE, html, {}, 'local-image-paths');
    html = injectScript(IMAGE_BLOBS_RE, html, {}, 'image-blobs');
    return { blob: new Blob([html], { type: 'text/html' }), filename: 'saves-archive.html' };
  }

  let html = shell;
  html = injectScript(INVENTORY_RE, html, inventory, 'inventory');
  html = injectScript(LOCAL_PATHS_RE, html, localPathsMap(files), 'local-image-paths');
  html = injectScript(IMAGE_BLOBS_RE, html, {}, 'image-blobs');

  const zip = new JSZip();
  zip.file('index.html', html);
  zip.file('inventory.json', JSON.stringify(inventory));
  const imagesDir = zip.folder('images')!;
  for (const f of files) {
    imagesDir.file(f.filename, await f.blob.arrayBuffer());
  }
  const zipBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  return { blob: zipBlob, filename: 'saves-archive.zip' };
}

// Backwards-compatible export name; kept as an alias for any in-flight callers
// while ExportMenu migrates to the new name.
export { exportArchive as exportHtml };
