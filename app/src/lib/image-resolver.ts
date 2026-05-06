// Render-time lookup that bridges (in priority order):
//   1. The IDB blob cache — the live app's primary store.
//   2. The remote URL — final fallback when nothing local exists.
//
// Caller owns the blob URL lifecycle: when isBlob is true, revoke the src via
// URL.revokeObjectURL when the consumer is destroyed.

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
