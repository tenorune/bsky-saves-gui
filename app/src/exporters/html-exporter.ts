import type { Inventory } from '../reader/inventory-shape';
import { buildZip, type ZipEntry } from './zip';
import { extractImageUrls } from '../lib/image-hydrator';
import { loadImageBlob } from '../lib/image-store';

export interface HtmlExportOptions {
  readonly mode: 'zip' | 'self-contained';
}

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

const ARCHIVE_URL = '/archive-template/index.html';
const INVENTORY_RE = /(<script type="application\/json" id="inventory">)[\s\S]*?(<\/script>)/;

function injectInventoryString(html: string, json: string): string {
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

function extOf(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('avif')) return 'avif';
  return 'bin';
}

async function urlToLocalName(url: string, blob: Blob): Promise<string> {
  const buf = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hex = [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `images/${hex}.${extOf(blob.type)}`;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function exportHtml(
  inventory: Inventory,
  options: HtmlExportOptions,
): Promise<ExportResult> {
  // The archive template is built as a single self-contained HTML file by
  // vite.archive.config.ts (vite-plugin-singlefile inlines all JS and CSS).
  const shell = await fetchText(ARCHIVE_URL);

  let inventoryJson = JSON.stringify(inventory).replace(/<\/script/gi, '<\\/script');
  const extraFiles: ZipEntry[] = [];

  if (options.mode === 'zip') {
    // Walk every image URL in the inventory; for each one we have bytes for,
    // add it to the zip under images/<hash>.<ext> and rewrite the URL inside
    // the JSON so the archive's <img> tags resolve to the local path.
    const urls = extractImageUrls(inventory);
    for (const url of urls) {
      const blob = await loadImageBlob(url);
      if (!blob) continue;
      const localPath = await urlToLocalName(url, blob);
      extraFiles.push({ path: localPath, content: blob });
      inventoryJson = inventoryJson.replace(
        new RegExp(escapeForRegex(JSON.stringify(url).slice(1, -1)), 'g'),
        JSON.stringify(localPath).slice(1, -1),
      );
    }
  }

  const withInventory = injectInventoryString(shell, inventoryJson);

  if (options.mode === 'zip') {
    const blob = await buildZip([
      { path: 'index.html', content: withInventory },
      ...extraFiles,
    ]);
    return { blob, filename: 'saves-archive.zip' };
  }

  return {
    blob: new Blob([withInventory], { type: 'text/html' }),
    filename: 'saves-archive.html',
  };
}
