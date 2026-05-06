const TABLE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Map a MIME type to a short file extension. Falls back to `bin` for unknown
 * types. Case-insensitive; ignores any `;`-separated parameters.
 */
export function mimeToExt(mime: string): string {
  const head = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return TABLE[head] ?? 'bin';
}
