import { extractImageUrls } from './extract-image-urls';
import { loadImageBlob } from './image-store';

export interface EmbeddedBlob {
  readonly mime: string;
  readonly data_b64: string;
}

export type EmbeddedBlobMap = Readonly<Record<string, EmbeddedBlob>>;

async function blobToBase64(blob: Blob): Promise<string> {
  // Use arrayBuffer() + btoa — works in Node (tests) and modern browsers.
  // Older browsers that lack arrayBuffer() can use FileReader as a fallback,
  // but all environments targeted by this project support it natively.
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Walk an inventory's image URLs, load each saved blob from IDB, and return
 * a map of url → { mime, data_b64 }. URLs without a saved blob are skipped.
 *
 * Used by the HTML exporter to embed image data directly into the export so
 * the resulting file is self-contained when opened on another machine.
 */
export async function gatherImageBlobs(inventory: unknown): Promise<EmbeddedBlobMap> {
  const urls = extractImageUrls(inventory);
  const out: Record<string, EmbeddedBlob> = {};
  for (const url of urls) {
    let blob: Blob | undefined;
    try {
      blob = await loadImageBlob(url);
    } catch {
      blob = undefined;
    }
    if (!blob) continue;
    const data_b64 = await blobToBase64(blob);
    const mime = blob.type !== '' ? blob.type : 'application/octet-stream';
    out[url] = { mime, data_b64 };
  }
  return out;
}
