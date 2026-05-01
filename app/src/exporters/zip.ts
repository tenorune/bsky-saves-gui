import JSZip from 'jszip';

export interface ZipEntry {
  readonly path: string;
  readonly content: string | Uint8Array | Blob;
}

export async function buildZip(entries: readonly ZipEntry[]): Promise<Blob> {
  const zip = new JSZip();
  for (const entry of entries) {
    if (entry.content instanceof Blob) {
      zip.file(entry.path, entry.content);
    } else {
      zip.file(entry.path, entry.content);
    }
  }
  return zip.generateAsync({ type: 'blob' });
}
