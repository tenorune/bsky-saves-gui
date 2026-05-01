import type { Inventory } from '../reader/inventory-shape';
import { buildZip, type ZipEntry } from './zip';

export interface HtmlExportOptions {
  readonly mode: 'zip' | 'self-contained';
}

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

const ARCHIVE_BASE = '/archive-template/';
const INVENTORY_RE = /(<script type="application\/json" id="inventory">)[\s\S]*?(<\/script>)/;

function injectInventory(html: string, inventory: Inventory): string {
  const json = JSON.stringify(inventory).replace(/<\/script/gi, '<\\/script');
  if (!INVENTORY_RE.test(html)) {
    throw new Error('Archive shell missing inventory script tag');
  }
  return html.replace(INVENTORY_RE, `$1\n${json}\n$2`);
}

interface ExtractedAssets {
  readonly scriptSrcs: readonly string[];
  readonly cssHrefs: readonly string[];
  readonly htmlWithoutAssets: string;
}

const SCRIPT_SRC_RE = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi;
const CSS_LINK_RE = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*\/?>/gi;

function extractAssets(html: string): ExtractedAssets {
  const scriptSrcs: string[] = [];
  const cssHrefs: string[] = [];
  let stripped = html.replace(SCRIPT_SRC_RE, (_match, src) => {
    if (typeof src === 'string' && src.length > 0) scriptSrcs.push(src);
    return '';
  });
  stripped = stripped.replace(CSS_LINK_RE, (_match, href) => {
    if (typeof href === 'string' && href.length > 0) cssHrefs.push(href);
    return '';
  });
  return { scriptSrcs, cssHrefs, htmlWithoutAssets: stripped };
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
  const shell = await fetchText(`${ARCHIVE_BASE}index.html`);
  const withInventory = injectInventory(shell, inventory);

  if (options.mode === 'zip') {
    const { scriptSrcs, cssHrefs } = extractAssets(withInventory);
    const entries: ZipEntry[] = [{ path: 'index.html', content: withInventory }];
    for (const src of scriptSrcs) {
      const path = src.replace(/^\/archive-template\//, '');
      entries.push({ path, content: await fetchText(src) });
    }
    for (const href of cssHrefs) {
      const path = href.replace(/^\/archive-template\//, '');
      entries.push({ path, content: await fetchText(href) });
    }
    const blob = await buildZip(entries);
    return { blob, filename: 'saves-archive.zip' };
  }

  // Self-contained: inline JS and CSS into the HTML.
  const { scriptSrcs, cssHrefs, htmlWithoutAssets } = extractAssets(withInventory);
  const inlinedScripts = await Promise.all(
    scriptSrcs.map(async (src) => `<script type="module">${await fetchText(src)}</script>`),
  );
  const inlinedStyles = await Promise.all(
    cssHrefs.map(async (href) => `<style>${await fetchText(href)}</style>`),
  );
  const finalHtml = htmlWithoutAssets.replace(
    '</head>',
    `${inlinedStyles.join('\n')}\n${inlinedScripts.join('\n')}\n</head>`,
  );
  return {
    blob: new Blob([finalHtml], { type: 'text/html' }),
    filename: 'saves-archive.html',
  };
}
