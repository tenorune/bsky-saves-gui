import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';

const WORKER_SCRIPT = 'templates/cf-worker/dist/worker-with-articles.bundle.js';
const GOOD_ORIGIN = 'https://saves.example.com';
const GOOD_SECRET = 'test-secret-abc123';
const EXPERIMENTAL = { disableExperimentalWarning: true };

async function startWorker(): Promise<UnstableDevWorker> {
  return unstable_dev(WORKER_SCRIPT, {
    vars: { ALLOWED_ORIGIN: GOOD_ORIGIN, SHARED_SECRET: GOOD_SECRET },
    experimental: EXPERIMENTAL,
  });
}

describe('worker-with-articles bundle', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await startWorker();
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('OPTIONS preflight authorizes GET, POST, and the X-Proxy-Secret header', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'OPTIONS',
      headers: { Origin: GOOD_ORIGIN },
    });
    expect(res.status).toBe(204);
    const allowedMethods = res.headers.get('Access-Control-Allow-Methods') ?? '';
    expect(allowedMethods).toContain('GET');
    expect(allowedMethods).toContain('POST');
    expect(allowedMethods).toContain('OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Proxy-Secret');
  });

  it('GET /capabilities lists both endpoints', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { endpoints: string[] };
    expect(body.endpoints).toEqual(['/fetch', '/extract-article']);
  });

  it('GET /capabilities rejects wrong secret', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': 'nope' },
    });
    expect(res.status).toBe(401);
  });

  it('echoes the matched origin in CORS reply with Vary: Origin', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(GOOD_ORIGIN);
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('POST /extract-article rejects wrong origin', async () => {
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /extract-article rejects missing url', async () => {
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /extract-article rejects javascript: scheme', async () => {
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'javascript:alert(1)' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /extract-article happy path returns parsed article shape', { timeout: 30_000 }, async () => {
    // Use example.com — small, stable, real article text via Readability is unlikely
    // (it's a very short page), so we expect note: "extracted body looked short" or similar.
    // The point of this test is the shape of the response, not the exact content.
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    expect([200, 502]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json() as {
        url: string; title: string; text: string; fetched_at: string; note?: string;
      };
      expect(body.url).toBe('https://example.com/');
      expect(typeof body.title).toBe('string');
      expect(typeof body.text).toBe('string');
      expect(typeof body.fetched_at).toBe('string');
      // example.com is short — expect a note.
      expect(body.note).toBeTypeOf('string');
    }
  });
});

describe('worker-with-articles multi-origin ALLOWED_ORIGIN', () => {
  const SECOND_ORIGIN = 'https://staging.example.com';
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await unstable_dev(WORKER_SCRIPT, {
      vars: {
        ALLOWED_ORIGIN: `${GOOD_ORIGIN}, ${SECOND_ORIGIN}`,
        SHARED_SECRET: GOOD_SECRET,
      },
      experimental: EXPERIMENTAL,
    });
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('allows the first listed origin', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(GOOD_ORIGIN);
  });

  it('allows the second listed origin and echoes it back', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: SECOND_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SECOND_ORIGIN);
  });

  it('rejects an origin not in the comma-separated list', async () => {
    const res = await worker.fetch('/capabilities', {
      method: 'GET',
      headers: { Origin: 'https://attacker.example.com', 'X-Proxy-Secret': GOOD_SECRET },
    });
    expect(res.status).toBe(403);
  });
});

describe('worker-with-articles URL_ALLOWLIST applies to /extract-article', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await unstable_dev(WORKER_SCRIPT, {
      vars: {
        ALLOWED_ORIGIN: GOOD_ORIGIN,
        SHARED_SECRET: GOOD_SECRET,
        URL_ALLOWLIST: 'https://allowed.example.com/',
      },
      experimental: EXPERIMENTAL,
    });
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('rejects URLs not on the allowlist', async () => {
    const res = await worker.fetch('/extract-article', {
      method: 'POST',
      headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://blocked.example.com/post' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not allowed/i);
  });
});
