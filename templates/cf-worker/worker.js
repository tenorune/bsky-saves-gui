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
