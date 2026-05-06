// Render-time lookup that bridges (in priority order):
//   1. A registered "local image paths" map — used by ZIP exports where each
//      URL maps to a relative path like `images/abc.png`.
//   2. A registered "embedded blob" map — used by single-file HTML exports
//      where each URL maps to base64 bytes returned as a `data:` URI.
//   3. The IDB blob cache — the live app's primary store.
//   4. The remote URL — final fallback when nothing local exists.
//
// Caller owns the blob URL lifecycle: when isBlob is true, revoke the src via
// URL.revokeObjectURL when the consumer is destroyed. data: URIs and relative
// paths report isBlob: false (no revoke needed).

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
let localImagePaths: Record<string, string> = {};

export function registerEmbeddedBlobs(map: Record<string, EmbeddedBlob>): void {
  embeddedBlobs = { ...map };
}

export function clearEmbeddedBlobs(): void {
  embeddedBlobs = {};
}

export function registerLocalImagePaths(map: Record<string, string>): void {
  localImagePaths = { ...map };
}

export function clearLocalImagePaths(): void {
  localImagePaths = {};
}

export async function resolveImageSrc(remoteUrl: string): Promise<ResolvedImage> {
  const localPath = localImagePaths[remoteUrl];
  if (localPath) {
    return { src: localPath, isBlob: false };
  }
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
