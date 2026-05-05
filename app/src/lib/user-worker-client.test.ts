import { describe, expect, it, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE_CONFIG = {
  url: 'https://my-worker.workers.dev',
  sharedSecret: 's3cret',
  supportsArticles: false,
};

describe('user-worker-client fetchImageViaUserWorker', () => {
  it('POSTs the URL with the shared secret and decodes body_b64 into a Blob', async () => {
    // 'IMG' base64-encoded
    const b64 = btoa('IMG');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body_b64: b64,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    const blob = await fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://cdn.bsky.app/img/foo.jpg');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://my-worker.workers.dev/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Proxy-Secret': 's3cret',
        }),
        body: JSON.stringify({ url: 'https://cdn.bsky.app/img/foo.jpg' }),
      }),
    );
  });

  it('falls back to application/octet-stream when the upstream omits Content-Type', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 200, headers: {}, body_b64: btoa('IMG') }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    const blob = await fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://x/y.jpg');
    expect(blob.type).toBe('application/octet-stream');
  });

  it('throws when the worker returns non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) })),
    );
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    await expect(
      fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://x/y.jpg'),
    ).rejects.toThrow(/401/);
  });

  it('throws when upstream status (inside the worker payload) is non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 404, headers: {}, body_b64: '' }),
      })),
    );
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    await expect(
      fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://x/missing.jpg'),
    ).rejects.toThrow(/upstream 404/);
  });

  it('throws on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    await expect(
      fetchImageViaUserWorker(SAMPLE_CONFIG, 'https://x/y.jpg'),
    ).rejects.toThrow();
  });

  it('strips a trailing slash from the worker URL before appending /fetch', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 200, headers: {}, body_b64: btoa('') }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchImageViaUserWorker } = await import('./user-worker-client');
    await fetchImageViaUserWorker(
      { ...SAMPLE_CONFIG, url: 'https://my-worker.workers.dev/' },
      'https://x/y.jpg',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://my-worker.workers.dev/fetch',
      expect.anything(),
    );
  });
});

import { extractArticleViaWorker, probeWorkerCapabilities, WorkerNoArticlesError } from './user-worker-client';

describe('extractArticleViaWorker', () => {
  const cfg = { url: 'https://w.example/', sharedSecret: 's', supportsArticles: true };

  it('returns the parsed article on 200', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url: 'https://a.example/post', title: 'T', text: 'body', fetched_at: '2026-05-05T00:00:00Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const out = await extractArticleViaWorker(cfg, 'https://a.example/post');
      expect(out.title).toBe('T');
      expect(out.text).toBe('body');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://w.example/extract-article',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Proxy-Secret': 's' }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws WorkerNoArticlesError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    try {
      await expect(extractArticleViaWorker(cfg, 'https://a.example/p')).rejects.toBeInstanceOf(WorkerNoArticlesError);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws Error with reason on 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'upstream timeout' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      await expect(extractArticleViaWorker(cfg, 'https://a.example/p')).rejects.toThrow(/upstream timeout/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ wrong: 'shape' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      await expect(extractArticleViaWorker(cfg, 'https://a.example/p')).rejects.toThrow(/malformed/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('probeWorkerCapabilities', () => {
  it('returns true when /extract-article is in the endpoints list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ endpoints: ['/fetch', '/extract-article'] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false when only /fetch is listed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ endpoints: ['/fetch'] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false when probe returns 404 (old worker, no /capabilities)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false when probe network call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    try {
      expect(await probeWorkerCapabilities('https://w.example/', 's')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
