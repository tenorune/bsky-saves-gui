import { describe, expect, it, vi } from 'vitest';
import { orchestrateRefresh } from './orchestrate-refresh';

describe('orchestrateRefresh', () => {
  it('calls fetch → enrich → threads in order when threads is true', async () => {
    const order: string[] = [];
    const fetchH = vi.fn().mockImplementation(async () => { order.push('fetch'); return { saves: [{ uri: 'at://a' }] }; });
    const enrichH = vi.fn().mockImplementation(async () => { order.push('enrich'); return { saves: [{ uri: 'at://a', post_created_at: 'X' }] }; });
    const threadH = vi.fn().mockImplementation(async () => { order.push('threads'); return { saves: [{ uri: 'at://a', post_created_at: 'X', thread_replies: [] }] }; });

    await orchestrateRefresh({
      credentials: { handle: 'a', appPassword: 'b', pds: 'c' },
      includeThreads: true,
      snapshot: {
        helper: { detected: true, version: '0.4.1', features: ['fetch', 'enrich', 'hydrate-threads', 'jwt-credentials'] },
        fetch: { kind: 'helper' }, enrich: { kind: 'helper' }, threads: { kind: 'helper' },
        images: { kind: 'helper' }, articles: { kind: 'helper' }, pyodideSource: 'cdn', loaded: true,
      },
      origin: 'http://x',
    }, { fetchHydrator: { start: fetchH }, enrichHydrator: { start: enrichH }, threadHydrator: { start: threadH } });

    expect(order).toEqual(['fetch', 'enrich', 'threads']);
  });

  it('skips threads when includeThreads is false', async () => {
    const fetchH = vi.fn().mockResolvedValue({ saves: [] });
    const enrichH = vi.fn().mockResolvedValue({ saves: [] });
    const threadH = vi.fn();
    await orchestrateRefresh({
      credentials: { handle: 'a', appPassword: 'b', pds: 'c' },
      includeThreads: false,
      snapshot: {
        helper: { detected: true, version: '0.4.1', features: ['fetch', 'enrich', 'hydrate-threads', 'jwt-credentials'] },
        fetch: { kind: 'helper' }, enrich: { kind: 'helper' }, threads: { kind: 'helper' },
        images: { kind: 'helper' }, articles: { kind: 'helper' }, pyodideSource: 'cdn', loaded: true,
      },
      origin: 'http://x',
    }, { fetchHydrator: { start: fetchH }, enrichHydrator: { start: enrichH }, threadHydrator: { start: threadH } });
    expect(threadH).not.toHaveBeenCalled();
  });
});
