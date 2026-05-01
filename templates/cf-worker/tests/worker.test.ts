import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';

// Path is relative to the repo root because wrangler resolves from cwd.
const WORKER_SCRIPT = 'templates/cf-worker/worker.js';

const GOOD_ORIGIN = 'https://saves.example.com';
const GOOD_SECRET = 'test-secret-abc123';

// Note: wrangler 3.114.17 deprecated the third apiOptions argument.
// disableExperimentalWarning must be placed inside options.experimental,
// and env vars must be passed as `vars` (not `env`, which is a named environment).
const EXPERIMENTAL = { disableExperimentalWarning: true };

// ---------------------------------------------------------------------------
// Helper: start a worker with the standard good env
// ---------------------------------------------------------------------------
async function startGoodWorker(): Promise<UnstableDevWorker> {
  return unstable_dev(
    WORKER_SCRIPT,
    {
      vars: { ALLOWED_ORIGIN: GOOD_ORIGIN, SHARED_SECRET: GOOD_SECRET },
      experimental: EXPERIMENTAL,
    },
  );
}

// ---------------------------------------------------------------------------
// OPTIONS preflight
// ---------------------------------------------------------------------------
describe('OPTIONS preflight', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await startGoodWorker();
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('returns 204 with CORS headers for the allowed origin', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'OPTIONS',
      headers: { Origin: GOOD_ORIGIN },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(GOOD_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Proxy-Secret');
  });

  it('returns 403 for a disallowed origin on preflight', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when Origin header is absent', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'OPTIONS',
      // no Origin header
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Misconfigured worker (missing env vars)
// ---------------------------------------------------------------------------
describe('misconfigured worker', () => {
  it('returns 500 when ALLOWED_ORIGIN is not set', async () => {
    const worker = await unstable_dev(
      WORKER_SCRIPT,
      { vars: { SHARED_SECRET: GOOD_SECRET }, experimental: EXPERIMENTAL }, // no ALLOWED_ORIGIN
    );
    try {
      const res = await worker.fetch('/fetch', {
        method: 'POST',
        headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/ALLOWED_ORIGIN/);
    } finally {
      await worker.stop();
    }
  });

  it('returns 500 when SHARED_SECRET is not set', async () => {
    const worker = await unstable_dev(
      WORKER_SCRIPT,
      { vars: { ALLOWED_ORIGIN: GOOD_ORIGIN }, experimental: EXPERIMENTAL }, // no SHARED_SECRET
    );
    try {
      const res = await worker.fetch('/fetch', {
        method: 'POST',
        headers: { Origin: GOOD_ORIGIN, 'X-Proxy-Secret': GOOD_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/SHARED_SECRET/);
    } finally {
      await worker.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /fetch — auth checks
// ---------------------------------------------------------------------------
describe('POST /fetch — authentication', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await startGoodWorker();
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('returns 401 when X-Proxy-Secret header is missing', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'POST',
      headers: { Origin: GOOD_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-Proxy-Secret header is wrong', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'POST',
      headers: {
        Origin: GOOD_ORIGIN,
        'Content-Type': 'application/json',
        'X-Proxy-Secret': 'wrong-secret',
      },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 when Origin is not in the allow-list', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example.com',
        'Content-Type': 'application/json',
        'X-Proxy-Secret': GOOD_SECRET,
      },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /fetch — URL validation
// ---------------------------------------------------------------------------
describe('POST /fetch — URL validation', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await startGoodWorker();
  });
  afterAll(async () => {
    await worker.stop();
  });

  function postFetch(url: unknown) {
    return worker.fetch('/fetch', {
      method: 'POST',
      headers: {
        Origin: GOOD_ORIGIN,
        'Content-Type': 'application/json',
        'X-Proxy-Secret': GOOD_SECRET,
      },
      body: JSON.stringify({ url }),
    });
  }

  it('returns 400 for a non-http(s) scheme (ftp)', async () => {
    const res = await postFetch('ftp://evil.example.com/file');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/http/i);
  });

  it('returns 400 for a non-http(s) scheme (file)', async () => {
    const res = await postFetch('file:///etc/passwd');
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-http(s) scheme (javascript)', async () => {
    const res = await postFetch('javascript:alert(1)');
    expect(res.status).toBe(400);
  });

  it('returns 400 when url field is missing', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'POST',
      headers: {
        Origin: GOOD_ORIGIN,
        'Content-Type': 'application/json',
        'X-Proxy-Secret': GOOD_SECRET,
      },
      body: JSON.stringify({ not_url: 'https://example.com' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not JSON', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'POST',
      headers: {
        Origin: GOOD_ORIGIN,
        'Content-Type': 'text/plain',
        'X-Proxy-Secret': GOOD_SECRET,
      },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /fetch — happy path (fetches a real URL via wrangler's local network)
// ---------------------------------------------------------------------------
describe('POST /fetch — happy path', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await startGoodWorker();
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('proxies an https URL and returns status, headers, and base64 body', async () => {
    // Use httpbin.org's /get endpoint which is CORS-permissive and stable.
    // If this test runs offline it will return 502, which is also acceptable
    // behaviour — the assertion is on the response shape when successful.
    const res = await worker.fetch('/fetch', {
      method: 'POST',
      headers: {
        Origin: GOOD_ORIGIN,
        'Content-Type': 'application/json',
        'X-Proxy-Secret': GOOD_SECRET,
      },
      body: JSON.stringify({ url: 'https://httpbin.org/get' }),
    });

    // Accept 200 (success) or 502 (network unavailable in CI).
    expect([200, 502]).toContain(res.status);

    if (res.status === 200) {
      const payload = await res.json() as {
        status: number;
        headers: Record<string, string>;
        body_b64: string;
      };
      // The upstream (httpbin.org) may return any HTTP status; we just check
      // the shape of the proxy response, not the upstream status.
      expect(typeof payload.status).toBe('number');
      expect(typeof payload.body_b64).toBe('string');
      expect(payload.body_b64.length).toBeGreaterThan(0);
      expect(typeof payload.headers).toBe('object');
    }
  });

  it('sets Access-Control-Allow-Origin on the response', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'POST',
      headers: {
        Origin: GOOD_ORIGIN,
        'Content-Type': 'application/json',
        'X-Proxy-Secret': GOOD_SECRET,
      },
      body: JSON.stringify({ url: 'https://httpbin.org/get' }),
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(GOOD_ORIGIN);
  });
});

// ---------------------------------------------------------------------------
// Routing — unknown paths / methods
// ---------------------------------------------------------------------------
describe('routing', () => {
  let worker: UnstableDevWorker;
  beforeAll(async () => {
    worker = await startGoodWorker();
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('returns 404 for GET /fetch', async () => {
    const res = await worker.fetch('/fetch', {
      method: 'GET',
      headers: { Origin: GOOD_ORIGIN },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for POST /unknown-path', async () => {
    const res = await worker.fetch('/unknown-path', {
      method: 'POST',
      headers: {
        Origin: GOOD_ORIGIN,
        'Content-Type': 'application/json',
        'X-Proxy-Secret': GOOD_SECRET,
      },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(404);
  });
});
