import type { Author } from './inventory-shape';

export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatHandle(handle: string): string {
  return handle.startsWith('@') ? handle : `@${handle}`;
}

export function formatAuthor(author: Author): string {
  return author.displayName?.trim() || author.handle;
}
