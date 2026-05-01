# Plan 6 — Cloudflare Worker Proxy Template

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single-file Cloudflare Worker (`templates/cf-worker/worker.js`) that the user deploys to their own account as a CORS proxy for article-URL fetches, with a wrangler config template, a tested vitest suite, and copy/paste deploy instructions.

**Architecture:** The worker runs in ES Modules format on the modern Cloudflare Workers runtime. It enforces an `ALLOWED_ORIGIN` env var for CORS origin-locking and a `SHARED_SECRET` env var checked via `X-Proxy-Secret` request header. On `POST /fetch` it fetches the target URL server-side and returns status, headers, and a base64-encoded body. Tests use vitest with `wrangler`'s `unstable_dev` API to spin up a real local Worker instance against the actual `worker.js` file. No bundler, no TypeScript compilation of the worker itself — it ships as plain JS.

**Tech Stack:** Cloudflare Workers (ES Modules), wrangler 3, vitest 2, Node 20, pnpm 9.

**Reference:** [Design spec](../specs/2026-05-01-bsky-saves-gui-design.md), Worker template section.

---

## File Structure

This plan creates:

```
bsky-saves-gui/
├── package.json                          # modified: add wrangler devDependency
└── templates/
    └── cf-worker/
        ├── worker.js                     # the Worker — ES Modules, single file
        ├── wrangler.toml.template        # minimal wrangler config the user copies & edits
        ├── README.md                     # deploy instructions
        └── tests/
            └── worker.test.ts            # vitest suite using unstable_dev
```

`.github/workflows/ci.yml` is modified to run the worker tests.

---

## Task 1: Directory skeleton and wrangler dependency

**Files:**
- Modify: `package.json`
- Create: `templates/cf-worker/worker.js` (stub)
- Create: `templates/cf-worker/wrangler.toml.template`

- [ ] **Step 1: Add `wrangler` as a dev dependency**

Open `package.json`. Add `"wrangler": "^3.101.0"` to `devDependencies`. The full updated `devDependencies` block:

```json
"devDependencies": {
  "@sveltejs/vite-plugin-svelte": "^3.1.2",
  "@testing-library/svelte": "^5.2.4",
  "@tsconfig/svelte": "^5.0.4",
  "@types/node": "^20.16.0",
  "jsdom": "^25.0.0",
  "prettier": "^3.3.3",
  "prettier-plugin-svelte": "^3.2.6",
  "svelte": "^4.2.19",
  "svelte-check": "^4.0.4",
  "typescript": "^5.6.3",
  "vite": "^5.4.10",
  "vitest": "^2.1.4",
  "wrangler": "^3.101.0"
}
```

- [ ] **Step 2: Install the dependency**

Run:
```bash
pnpm install
```

Expected: `pnpm-lock.yaml` updates, wrangler appears under `node_modules/.bin/wrangler`. No errors.

- [ ] **Step 3: Create the directory structure**

Run:
```bash
mkdir -p /home/user/bsky-saves-gui/templates/cf-worker/tests
```

- [ ] **Step 4: Create the stub `worker.js`**

Create `templates/cf-worker/worker.js` with this content — it is a valid ES Modules Worker that returns 501 for everything, giving the tests something real to import while the implementation is written in the next task:

```js
// Cloudflare Worker — CORS proxy for bsky-saves-gui article hydration.
// Deploy instructions: see README.md in this directory.
// Environment variables (set via `wrangler secret put`):
//   ALLOWED_ORIGIN  — the Origin header value allowed to call this worker
//                     (e.g. "https://saves.lightseed.net")
//   SHARED_SECRET   — arbitrary secret; callers must send it as X-Proxy-Secret

export default {
  /** @param {Request} request @param {Env} env */
  async fetch(request, env) {
    return new Response('Not implemented', { status: 501 });
  },
};
```

- [ ] **Step 5: Create `wrangler.toml.template`**

Create `templates/cf-worker/wrangler.toml.template`:

```toml
# Copy this file to wrangler.toml and fill in your values.
# Do NOT commit wrangler.toml — it contains no secrets, but keeping it as
# a template avoids accidental overwrite when pulling updates.

name = "bsky-saves-gui-proxy"
main = "worker.js"
compatibility_date = "2025-01-01"

# Secrets are NOT stored here. Set them with:
#   wrangler secret put SHARED_SECRET
#   wrangler secret put ALLOWED_ORIGIN
#
# ALLOWED_ORIGIN  — the full origin of your deployed app
#                   e.g. "https://saves.lightseed.net"
# SHARED_SECRET   — a long random string; the app shows you a generated one
#                   in Settings → Proxy setup.
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml templates/cf-worker/worker.js templates/cf-worker/wrangler.toml.template
git commit -m "chore(worker): scaffold cf-worker template directory and add wrangler dep"
```

---

## Task 2: Worker implementation

**Files:**
- Modify: `templates/cf-worker/worker.js`

The worker handles exactly two route shapes:
- `OPTIONS *` — CORS preflight response.
- `POST /fetch` — proxy a URL and return the result.

Everything else gets a 404. All requests first check that `ALLOWED_ORIGIN` is configured and matches the `Origin` header.

- [ ] **Step 1: Replace the stub with the full implementation**

Overwrite `templates/cf-worker/worker.js` with:

```js
// Cloudflare Worker — CORS proxy for bsky-saves-gui article hydration.
// Deploy instructions: see README.md in this directory.
// Environment variables (set via `wrangler secret put`):
//   ALLOWED_ORIGIN  — the Origin header value allowed to call this worker
//                     (e.g. "https://saves.lightseed.net")
//   SHARED_SECRET   — arbitrary secret; callers must send it as X-Proxy-Secret

const FETCH_TIMEOUT_MS = 20_000;
const BODY_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

/**
 * @typedef {{ ALLOWED_ORIGIN: string; SHARED_SECRET: string }} Env
 */

/**
 * Build CORS headers for a given allowed origin.
 * @param {string} allowedOrigin
 * @returns {Record<string, string>}
 */
function corsHeaders(allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Return a JSON error response.
 * @param {string} message
 * @param {number} status
 * @param {Record<string, string>} [extraHeaders]
 */
function jsonError(message, status, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    // 1. Validate configuration — fail hard if secrets are missing.
    if (!env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN.trim() === '') {
      return jsonError('Worker misconfigured: ALLOWED_ORIGIN is not set', 500);
    }
    if (!env.SHARED_SECRET || env.SHARED_SECRET.trim() === '') {
      return jsonError('Worker misconfigured: SHARED_SECRET is not set', 500);
    }

    const allowedOrigin = env.ALLOWED_ORIGIN.trim();
    const requestOrigin = request.headers.get('Origin') ?? '';

    // 2. Validate Origin header.
    if (requestOrigin !== allowedOrigin) {
      return jsonError('Origin not allowed', 403);
    }

    const cors = corsHeaders(allowedOrigin);

    // 3. Handle CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // 4. Only POST /fetch is supported beyond preflight.
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/fetch') {
      return new Response('Not found', { status: 404, headers: cors });
    }

    // 5. Validate shared secret.
    const secret = request.headers.get('X-Proxy-Secret') ?? '';
    if (secret !== env.SHARED_SECRET) {
      return jsonError('Unauthorized', 401, cors);
    }

    // 6. Parse and validate request body.
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Request body must be JSON', 400, cors);
    }

    const targetUrl = body?.url;
    if (typeof targetUrl !== 'string' || targetUrl.trim() === '') {
      return jsonError('Body must contain a non-empty "url" string', 400, cors);
    }

    // 7. Validate URL scheme (http or https only).
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return jsonError('Invalid URL', 400, cors);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return jsonError('Only http and https URLs are allowed', 400, cors);
    }

    // 8. Fetch the upstream URL with a timeout.
    let upstream;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        upstream = await fetch(parsed.toString(), {
          signal: controller.signal,
          headers: { 'User-Agent': 'bsky-saves-gui-proxy/1' },
          redirect: 'follow',
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      return jsonError(
        isTimeout ? 'Upstream fetch timed out' : `Upstream fetch failed: ${err.message}`,
        502,
        cors,
      );
    }

    // 9. Enforce body size cap.
    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength !== null && parseInt(contentLength, 10) > BODY_SIZE_LIMIT) {
      return jsonError('Upstream response too large', 502, cors);
    }

    let upstreamBytes;
    try {
      const buf = await upstream.arrayBuffer();
      if (buf.byteLength > BODY_SIZE_LIMIT) {
        return jsonError('Upstream response too large', 502, cors);
      }
      upstreamBytes = buf;
    } catch (err) {
      return jsonError(`Failed to read upstream body: ${err.message}`, 502, cors);
    }

    // 10. Encode the body as base64 and return.
    // btoa operates on binary strings; convert the ArrayBuffer first.
    const uint8 = new Uint8Array(upstreamBytes);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const bodyB64 = btoa(binary);

    // Collect response headers as a plain object (exclude hop-by-hop headers).
    const skipHeaders = new Set([
      'connection',
      'keep-alive',
      'transfer-encoding',
      'te',
      'trailer',
      'upgrade',
      'proxy-authorization',
      'proxy-authenticate',
    ]);
    /** @type {Record<string, string>} */
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    return new Response(
      JSON.stringify({
        status: upstream.status,
        headers: responseHeaders,
        body_b64: bodyB64,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...cors },
      },
    );
  },
};
```

- [ ] **Step 2: Verify the file is valid JavaScript**

Run:
```bash
node --input-type=module < /home/user/bsky-saves-gui/templates/cf-worker/worker.js
```

Expected: the script exits without error (it imports nothing that requires a runtime, so Node can parse and evaluate it).

- [ ] **Step 3: Commit**

```bash
git add templates/cf-worker/worker.js
git commit -m "feat(worker): implement CORS proxy with origin check, secret auth, and fetch"
```

---

## Task 3: Tests with `unstable_dev`

**Files:**
- Create: `templates/cf-worker/tests/worker.test.ts`

`wrangler`'s `unstable_dev` API starts a local Worker process against the real `worker.js` file and returns a `fetch`-compatible interface. Tests call that interface directly — no mocking of the worker logic.

The `unstable_dev` function signature:

```ts
unstable_dev(
  workerScript: string,                      // path to worker.js
  options?: { env?: Record<string,string> }, // simulated env vars
  deviceOptions?: { disableExperimentalWarning?: boolean }
): Promise<UnstableDevWorker>

interface UnstableDevWorker {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
  stop(): Promise<void>;
}
```

Each test group (`describe` block) starts its own worker instance with the env vars it needs, so tests are isolated.

- [ ] **Step 1: Write the failing tests**

Create `templates/cf-worker/tests/worker.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';

// Path is relative to the repo root because wrangler resolves from cwd.
const WORKER_SCRIPT = 'templates/cf-worker/worker.js';

const GOOD_ORIGIN = 'https://saves.example.com';
const GOOD_SECRET = 'test-secret-abc123';

const DEV_OPTIONS = { disableExperimentalWarning: true };

// ---------------------------------------------------------------------------
// Helper: start a worker with the standard good env
// ---------------------------------------------------------------------------
async function startGoodWorker(): Promise<UnstableDevWorker> {
  return unstable_dev(
    WORKER_SCRIPT,
    { env: { ALLOWED_ORIGIN: GOOD_ORIGIN, SHARED_SECRET: GOOD_SECRET } },
    DEV_OPTIONS,
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
      { env: { SHARED_SECRET: GOOD_SECRET } }, // no ALLOWED_ORIGIN
      DEV_OPTIONS,
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
      { env: { ALLOWED_ORIGIN: GOOD_ORIGIN } }, // no SHARED_SECRET
      DEV_OPTIONS,
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
      expect(payload.status).toBe(200);
      expect(typeof payload.body_b64).toBe('string');
      expect(payload.body_b64.length).toBeGreaterThan(0);
      // Decode and verify it's JSON (httpbin always returns JSON)
      const decoded = atob(payload.body_b64);
      expect(() => JSON.parse(decoded)).not.toThrow();
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from the repo root:
```bash
pnpm exec vitest run templates/cf-worker/tests/worker.test.ts
```

Expected: FAIL — either `Cannot find module 'wrangler'` (if install didn't work) or tests against the stub `worker.js` return `501` where `204`, `401`, `403`, `400` are expected. The stub returns `501` for everything, so most tests will fail.

- [ ] **Step 3: Run the tests against the full implementation**

The full `worker.js` was written in Task 2. The tests should now pass (except the happy-path test which depends on network; `502` is an accepted outcome). Run:

```bash
pnpm exec vitest run templates/cf-worker/tests/worker.test.ts
```

Expected output (approximate):
```
 ✓ templates/cf-worker/tests/worker.test.ts (14)
   ✓ OPTIONS preflight (3)
   ✓ misconfigured worker (2)
   ✓ POST /fetch — authentication (3)
   ✓ POST /fetch — URL validation (5)
   ✓ POST /fetch — happy path (2)
   ✓ routing (2)

 Test Files  1 passed (1)
 Tests       14 passed (14)
```

If the happy-path test times out waiting for `httpbin.org` to respond, it will show as slow but should still pass (502 is accepted). If the test suite itself hangs waiting on a worker that never starts, confirm wrangler is installed: `pnpm exec wrangler --version`.

- [ ] **Step 4: Commit**

```bash
git add templates/cf-worker/tests/worker.test.ts
git commit -m "test(worker): vitest suite covering CORS, auth, URL validation, routing, and happy path"
```

---

## Task 4: README with deploy instructions

**Files:**
- Create: `templates/cf-worker/README.md`

- [ ] **Step 1: Create `templates/cf-worker/README.md`**

```markdown
# Cloudflare Worker Proxy — Deploy Instructions

This directory contains a single-file Cloudflare Worker that acts as a CORS
proxy for article-URL fetches made by bsky-saves-gui. Deploy it to **your own
Cloudflare account** — the app developer never sees your traffic.

## What it does

`POST /fetch` accepts a JSON body `{"url": "<https URL>"}`, fetches the URL
server-side (bypassing browser CORS restrictions), and returns:

```json
{
  "status": 200,
  "headers": { "content-type": "text/html; charset=utf-8" },
  "body_b64": "<base64-encoded response body>"
}
```

Callers must send `X-Proxy-Secret` matching the secret you set. Only requests
from `ALLOWED_ORIGIN` are accepted.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is
  sufficient).
- [Node.js](https://nodejs.org) 18 or later.
- `wrangler` CLI — the Cloudflare deployment tool.

## Step 1 — Install wrangler

```bash
npm install -g wrangler
```

Verify:
```bash
wrangler --version
```

## Step 2 — Log in to Cloudflare

```bash
wrangler login
```

This opens a browser window. Authorize wrangler. Close the tab when prompted.

## Step 3 — Copy the template files

Copy the two files from this directory into a new working folder:

```bash
mkdir my-bsky-proxy
cp worker.js my-bsky-proxy/
cp wrangler.toml.template my-bsky-proxy/wrangler.toml
cd my-bsky-proxy
```

## Step 4 — Customize `wrangler.toml`

Open `wrangler.toml` and set `name` to something meaningful for your account,
for example:

```toml
name = "my-bsky-saves-proxy"
main = "worker.js"
compatibility_date = "2025-01-01"
```

You can leave everything else as-is.

## Step 5 — Get your secrets from the app

Open bsky-saves-gui in your browser and go to **Settings → Proxy setup**.
The app generates a fresh `SHARED_SECRET` for you and shows the values to paste.
You need two strings:

| Value | Where to find it |
|---|---|
| `SHARED_SECRET` | Generated by the app in Settings → Proxy setup |
| `ALLOWED_ORIGIN` | The origin of your bsky-saves-gui deployment, e.g. `https://saves.lightseed.net` |

## Step 6 — Set the secrets

Run the following two commands in your `my-bsky-proxy` folder. Wrangler will
prompt you to paste the value for each:

```bash
wrangler secret put SHARED_SECRET
```
Paste the `SHARED_SECRET` shown by the app. Press Enter.

```bash
wrangler secret put ALLOWED_ORIGIN
```
Paste your app's origin (e.g. `https://saves.lightseed.net`). Press Enter.

Secrets are encrypted and stored by Cloudflare. They are never in `wrangler.toml`
and never committed to any repository.

## Step 7 — Deploy

```bash
wrangler deploy
```

Expected output (last line):
```
Published my-bsky-saves-proxy (x.xx sec)
  https://my-bsky-saves-proxy.<your-subdomain>.workers.dev
```

Copy the worker URL.

## Step 8 — Configure the app

Back in bsky-saves-gui, in **Settings → Proxy setup**, paste the worker URL
into the "Worker URL" field and save. The app will probe the worker with your
`SHARED_SECRET` to confirm it's reachable.

## Updating

When a new version of `worker.js` is published in this repo, copy it over your
existing `worker.js` and run `wrangler deploy` again. Secrets are preserved.

## Security notes

- `ALLOWED_ORIGIN` locks the worker to your app's origin. Requests from any
  other origin receive `403 Forbidden`.
- `SHARED_SECRET` ensures only your app (which knows the secret) can use the
  proxy. Requests without the correct `X-Proxy-Secret` header receive `401 Unauthorized`.
- Only `http://` and `https://` URLs are proxied. Other schemes are rejected.
- Upstream responses larger than 10 MB are refused.
- Upstream fetches time out after 20 seconds.
- The free Cloudflare Workers tier allows 100,000 requests per day, which
  is more than enough for personal use of bsky-saves-gui.

## Endpoints

### `OPTIONS *`

CORS preflight. Returns `204 No Content` with the appropriate CORS headers
when `Origin` matches `ALLOWED_ORIGIN`. Returns `403` otherwise.

### `POST /fetch`

Required headers:
- `Origin: <ALLOWED_ORIGIN>` — must match the configured value.
- `X-Proxy-Secret: <SHARED_SECRET>` — must match the configured value.
- `Content-Type: application/json`

Request body:
```json
{ "url": "https://example.com/article" }
```

Success response (`200 OK`):
```json
{
  "status": 200,
  "headers": { "content-type": "text/html; charset=utf-8" },
  "body_b64": "PGh0bWw+..."
}
```

Error responses follow the same JSON shape:
```json
{ "error": "Unauthorized" }
```

| HTTP Status | Meaning |
|---|---|
| `204` | Preflight OK |
| `400` | Bad request (invalid URL, missing field, non-JSON body) |
| `401` | Wrong or missing `X-Proxy-Secret` |
| `403` | Origin not allowed |
| `404` | Unknown path or method |
| `500` | Worker misconfigured (missing env var) |
| `502` | Upstream fetch failed or timed out |
```

- [ ] **Step 2: Commit**

```bash
git add templates/cf-worker/README.md
git commit -m "docs(worker): add deploy instructions README for cf-worker template"
```

---

## Task 5: CI — run worker tests

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a worker-test step to the existing CI job**

Open `.github/workflows/ci.yml`. Add a new step after the existing `pnpm test` step:

```yaml
      - name: Test Cloudflare Worker
        run: pnpm exec vitest run templates/cf-worker/tests/worker.test.ts
        timeout-minutes: 3
```

The full updated file:

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm check

      - run: pnpm test

      - name: Test Cloudflare Worker
        run: pnpm exec vitest run templates/cf-worker/tests/worker.test.ts
        timeout-minutes: 3

      - name: Build (using example env)
        run: |
          cp .env.example .env
          pnpm build

      - name: Confirm CNAME is in dist
        run: |
          test -f dist/CNAME
          cat dist/CNAME
```

Note: `timeout-minutes: 3` prevents a hung `unstable_dev` process from blocking the workflow indefinitely. The happy-path test that calls `httpbin.org` will simply resolve to `502` if the network is unavailable in CI, which the test accepts.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add worker template test step to CI workflow"
```

---

## Final verification

- [ ] **Step 1: Run the complete test suite from the repo root**

Run:
```bash
pnpm test
```

Expected: all existing vitest tests pass (config, router). This command uses the root `vitest.config.ts` which targets `src/**/*.test.ts`, so it does not include the worker tests. That is intentional — the worker tests are run separately because they require wrangler's local runtime.

- [ ] **Step 2: Run the worker tests explicitly**

Run:
```bash
pnpm exec vitest run templates/cf-worker/tests/worker.test.ts
```

Expected: 14 tests pass. The happy-path tests accept `502` when the network is unavailable.

- [ ] **Step 3: Lint the worker file for obvious issues**

Run:
```bash
node --input-type=module < /home/user/bsky-saves-gui/templates/cf-worker/worker.js
```

Expected: exits cleanly (0), no syntax errors.

- [ ] **Step 4: Confirm files are in place**

Run:
```bash
ls -1 /home/user/bsky-saves-gui/templates/cf-worker/
```

Expected:
```
README.md
tests/
worker.js
wrangler.toml.template
```

---

## Done criteria

After this plan, all of the following must be true:

1. `pnpm install && pnpm test` succeeds on a fresh clone (existing tests unaffected).
2. `pnpm exec vitest run templates/cf-worker/tests/worker.test.ts` passes with 14 tests.
3. `templates/cf-worker/worker.js` is a valid ES Modules Worker: `OPTIONS *` returns 204 with CORS headers for the allowed origin; `POST /fetch` with correct secret and an https URL returns `{"status":…,"headers":…,"body_b64":…}`; wrong origin → 403; wrong/missing secret → 401; non-http(s) URL → 400; missing env vars → 500.
4. `templates/cf-worker/wrangler.toml.template` documents all required customisation and instructs the user to set secrets via `wrangler secret put`.
5. `templates/cf-worker/README.md` contains complete, copy/paste-ready deploy steps from installing wrangler through running `wrangler deploy` and configuring the app.
6. CI workflow runs the worker tests on every PR and push to `main`.

Plan 7 (settings UI) will add the Settings → Proxy setup flow that generates the `SHARED_SECRET` and shows the worker URL field to the user.
