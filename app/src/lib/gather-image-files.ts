import { extractImageUrls } from './extract-image-urls';
import { loadImageBlob } from './image-store';
import { mimeToExt } from './mime-to-ext';

export interface GatheredImageFile {
  readonly url: string;
  readonly filename: string;
  readonly blob: Blob;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(hash);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Walk an inventory's image URLs, load each saved blob from IDB, and return
 * a list of `{url, filename, blob}` entries. Filenames are derived from
 * SHA-256(url) + an extension chosen via the blob's MIME type, so they're
 * stable across calls and across exports of the same inventory.
 *
 * URLs without a saved blob are skipped. Output is sorted by URL for
 * deterministic ordering.
 */
export async function gatherImageFiles(
  inventory: unknown,
): Promise<GatheredImageFile[]> {
  const urls = [...extractImageUrls(inventory)].sort();
  const out: GatheredImageFile[] = [];
  for (const url of urls) {
    let blob: Blob | undefined;
    try {
      blob = await loadImageBlob(url);
    } catch {
      blob = undefined;
    }
    if (!blob) continue;
    const hash = await sha256Hex(url);
    const ext = mimeToExt(blob.type);
    out.push({ url, filename: `${hash}.${ext}`, blob });
  }
  return out;
}
