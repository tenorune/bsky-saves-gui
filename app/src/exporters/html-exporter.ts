import type { Inventory } from '../reader/inventory-shape';
import { buildZip, type ZipEntry } from './zip';
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

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface LocalImageRef {
  url: string;
  path: string;
}

function collectLocalImages(inventory: unknown): LocalImageRef[] {
  const out = new Map<string, string>();
  const visit = (entry: unknown): void => {
    if (!entry || typeof entry !== 'object') return;
    const e = entry as Record<string, unknown>;
    const local = e.local_images;
    if (Array.isArray(local)) {
      for (const li of local as Array<Record<string, unknown>>) {
        const url = typeof li.url === 'string' ? li.url : null;
        const path = typeof li.path === 'string' ? li.path : null;
        if (url && path && !out.has(url)) out.set(url, path);
      }
    }
    visit(e.quoted_post);
  };
  if (inventory && typeof inventory === 'object') {
    const inv = inventory as { saves?: unknown[] };
    if (Array.isArray(inv.saves)) for (const save of inv.saves) visit(save);
  }
  return [...out].map(([url, path]) => ({ url, path }));
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
    // bsky-saves' images.hydrate_images already wrote local_images:[{url,path}]
    // entries with a stable filename per URL. For each one we have bytes for,
    // include the file at images/<path> and rewrite occurrences of the URL
    // inside the inventory JSON so <img> tags in the archive load locally.
    for (const { url, path } of collectLocalImages(inventory)) {
      const blob = await loadImageBlob(url);
      if (!blob) continue;
      const localPath = `images/${path}`;
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
