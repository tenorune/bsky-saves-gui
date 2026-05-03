import type { Inventory } from '../reader/inventory-shape';

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
  // Function-form replace so `$` characters in the JSON aren't treated as
  // backreferences.
  return html.replace(INVENTORY_RE, (_match, openTag, closeTag) =>
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
  const withInventory = injectInventory(shell, inventory);
  return {
    blob: new Blob([withInventory], { type: 'text/html' }),
    filename: 'saves-archive.html',
  };
}
