import type { Inventory } from '../reader/inventory-shape';
import { gatherImageBlobs } from '../lib/gather-image-blobs';

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

const ARCHIVE_URL = '/archive-template/index.html';
const INVENTORY_RE = /(<script type="application\/json" id="inventory">)[\s\S]*?(<\/script>)/;
const IMAGE_BLOBS_RE = /(<script type="application\/json" id="image-blobs">)[\s\S]*?(<\/script>)/;

function injectInventory(html: string, inventory: Inventory): string {
  const json = JSON.stringify(inventory).replace(/<\/script/gi, '<\\/script');
  if (!INVENTORY_RE.test(html)) {
    throw new Error('Archive shell missing inventory script tag');
  }
  return html.replace(INVENTORY_RE, (_match, openTag, closeTag) =>
    `${openTag}\n${json}\n${closeTag}`,
  );
}

function injectImageBlobs(html: string, blobs: unknown): string {
  const json = JSON.stringify(blobs).replace(/<\/script/gi, '<\\/script');
  if (!IMAGE_BLOBS_RE.test(html)) {
    throw new Error('Archive shell missing image-blobs script tag');
  }
  return html.replace(IMAGE_BLOBS_RE, (_match, openTag, closeTag) =>
    `${openTag}\n${json}\n${closeTag}`,
  );
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

export async function exportHtml(inventory: Inventory): Promise<ExportResult> {
  const shell = await fetchText(ARCHIVE_URL);
  const blobs = await gatherImageBlobs(inventory);
  const withInventory = injectInventory(shell, inventory);
  const withBlobs = injectImageBlobs(withInventory, blobs);
  return {
    blob: new Blob([withBlobs], { type: 'text/html' }),
    filename: 'saves-archive.html',
  };
}
