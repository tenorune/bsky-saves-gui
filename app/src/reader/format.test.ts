import { describe, expect, it } from 'vitest';

describe('format', () => {
  it('formatDate renders ISO timestamps as YYYY-MM-DD', async () => {
    const { formatDate } = await import('./format');
    expect(formatDate('2026-04-15T12:34:56Z')).toBe('2026-04-15');
  });

  it('formatDateTime renders ISO timestamps as a friendly string', async () => {
    const { formatDateTime } = await import('./format');
    // Locale-dependent; just check that something non-empty and contains the year.
    const out = formatDateTime('2026-04-15T12:34:56Z');
    expect(out).toMatch(/2026/);
    expect(out.length).toBeGreaterThan(4);
  });

  it('formatHandle prefixes with @', async () => {
    const { formatHandle } = await import('./format');
    expect(formatHandle('alice.bsky.social')).toBe('@alice.bsky.social');
    expect(formatHandle('@alice.bsky.social')).toBe('@alice.bsky.social');
  });

  it('handlesAuthor prefers displayName, falls back to handle', async () => {
    const { formatAuthor } = await import('./format');
    expect(formatAuthor({ did: 'd', handle: 'h.example', displayName: 'Hubert' })).toBe('Hubert');
    expect(formatAuthor({ did: 'd', handle: 'h.example' })).toBe('h.example');
  });
});
