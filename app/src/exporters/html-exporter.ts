import type { Inventory } from '../reader/inventory-shape';
import { buildZip } from './zip';

export interface HtmlExportOptions {
  readonly mode: 'zip' | 'self-contained';
}

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

const ARCHIVE_URL = '/archive-template/index.html';
const INVENTORY_RE = /(<script type="application\/json" id="inventory">)[\s\S]*?(<\/script>)/;

function injectInventory(html: string, inventory: Inventory): string {
  const json = JSON.stringify(inventory).replace(/<\/script/gi, '<\\/script');
  if (!INVENTORY_RE.test(html)) {
    throw new Error('Archive shell missing inventory script tag');
  }
  return html.replace(INVENTORY_RE, `$1\n${json}\n$2`);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

export async function exportHtml(
  inventory: Inventory,
  options: HtmlExportOptions,
): Promise<ExportResult> {
  // The archive template is built as a single self-contained HTML file by
  // vite.archive.config.ts (vite-plugin-singlefile inlines all JS and CSS).
  // We just need to fetch it, inject the user's inventory, and ship it.
  const shell = await fetchText(ARCHIVE_URL);
  const withInventory = injectInventory(shell, inventory);

  if (options.mode === 'zip') {
    const blob = await buildZip([{ path: 'index.html', content: withInventory }]);
    return { blob, filename: 'saves-archive.zip' };
  }

  return {
    blob: new Blob([withInventory], { type: 'text/html' }),
    filename: 'saves-archive.html',
  };
}
