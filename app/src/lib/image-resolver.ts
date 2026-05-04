// Render-time lookup that bridges image-store (IDB blob cache) with the
// remote URL. Returns the URL the GUI should hand to <img src=...>.
//
// Caller owns the blob URL lifecycle: when isBlob is true, revoke the src
// via URL.revokeObjectURL when the consumer is destroyed.

import { loadImageBlob } from './image-store';

export interface ResolvedImage {
  readonly src: string;
  readonly isBlob: boolean;
}

export async function resolveImageSrc(remoteUrl: string): Promise<ResolvedImage> {
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
