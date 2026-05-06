// Render-time lookup that bridges image-store (IDB blob cache), an in-memory
// "embedded blob" map (used by exported archives where IDB starts empty),
// and the remote URL. Returns the URL the GUI should hand to <img src=...>.
//
// Caller owns the blob URL lifecycle: when isBlob is true, revoke the src
// via URL.revokeObjectURL when the consumer is destroyed. Embedded data:
// URIs don't need revoking and report isBlob: false.

import { loadImageBlob } from './image-store';

export interface ResolvedImage {
  readonly src: string;
  readonly isBlob: boolean;
}

interface EmbeddedBlob {
  readonly mime: string;
  readonly data_b64: string;
}

let embeddedBlobs: Record<string, EmbeddedBlob> = {};

/**
 * Register a map of url → { mime, data_b64 } for use by `resolveImageSrc`.
 * Used by the archive bootstrap when the page is opened from an exported
 * HTML file. Subsequent calls replace the registered map (idempotent).
 */
export function registerEmbeddedBlobs(map: Record<string, EmbeddedBlob>): void {
  embeddedBlobs = { ...map };
}

/**
 * Clear the registered embedded-blob map. Test hook.
 */
export function clearEmbeddedBlobs(): void {
  embeddedBlobs = {};
}

export async function resolveImageSrc(remoteUrl: string): Promise<ResolvedImage> {
  const embedded = embeddedBlobs[remoteUrl];
  if (embedded) {
    return { src: `data:${embedded.mime};base64,${embedded.data_b64}`, isBlob: false };
  }
  try {
    const blob = await loadImageBlob(remoteUrl);
    if (blob) {
      return { src: URL.createObjectURL(blob), isBlob: true };
    }
  } catch {
    // IDB unavailable (private mode, quota, etc.) — fall through to remote.
  }
  return { src: remoteUrl, isBlob: false };
}
