import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

interface Env {
  ALLOWED_ORIGIN: string;
  SHARED_SECRET: string;
  URL_ALLOWLIST?: string;
}

const FETCH_TIMEOUT_MS = 20_000;
const BODY_SIZE_LIMIT = 10 * 1024 * 1024;
const SHORT_TEXT_THRESHOLD = 200;

function parseAllowedOrigins(raw: string): string[] {
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

function corsHeaders(matchedOrigin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': matchedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonError(message: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function jsonOk(payload: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function checkAllowlist(allowlist: string, target: string): boolean {
  const trimmed = allowlist.trim();
  if (trimmed === '') return true;
  const prefixes = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  return prefixes.some((p) => target.startsWith(p));
}

async function fetchWithLimits(url: string): Promise<{ ok: true; res: Response } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'bsky-saves-gui-proxy/1' },
      redirect: 'follow',
    });
    return { ok: true, res };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: isTimeout ? 'Upstream fetch timed out' : `Upstream fetch failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readBodyCapped(res: Response): Promise<{ ok: true; bytes: ArrayBuffer } | { ok: false; reason: string }> {
  const contentLength = res.headers.get('Content-Length');
  if (contentLength !== null && parseInt(contentLength, 10) > BODY_SIZE_LIMIT) {
    return { ok: false, reason: 'Upstream response too large' };
  }
  try {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > BODY_SIZE_LIMIT) {
      return { ok: false, reason: 'Upstream response too large' };
    }
    return { ok: true, bytes: buf };
  } catch (err) {
    return { ok: false, reason: `Failed to read upstream body: ${(err as Error).message}` };
  }
}

function bytesToBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary);
}

function bytesToUtf8(buf: ArrayBuffer): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

async function handleFetch(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const secret = request.headers.get('X-Proxy-Secret') ?? '';
  // TEMP DEBUG — remove after diagnosing /extract-article 401 asymmetry.
  console.log('fetch auth:', {
    gotPrefix: secret.slice(0, 4),
    expPrefix: (env.SHARED_SECRET ?? '').slice(0, 4),
    gotLen: secret.length,
    expLen: (env.SHARED_SECRET ?? '').length,
    match: secret === env.SHARED_SECRET,
  });
  if (secret !== env.SHARED_SECRET) return jsonError('Unauthorized', 401, cors);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be JSON', 400, cors);
  }
  const targetUrl = (body as { url?: unknown })?.url;
  if (typeof targetUrl !== 'string' || targetUrl.trim() === '') {
    return jsonError('Body must contain a non-empty "url" string', 400, cors);
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return jsonError('Invalid URL', 400, cors);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return jsonError('Only http and https URLs are allowed', 400, cors);
  }
  if (!checkAllowlist(env.URL_ALLOWLIST ?? '', targetUrl)) {
    return jsonError('url not allowed', 400, cors);
  }

  const upstream = await fetchWithLimits(parsed.toString());
  if (!upstream.ok) return jsonError(upstream.reason, 502, cors);

  const read = await readBodyCapped(upstream.res);
  if (!read.ok) return jsonError(read.reason, 502, cors);

  const skipHeaders = new Set([
    'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer',
    'upgrade', 'proxy-authorization', 'proxy-authenticate',
  ]);
  const responseHeaders: Record<string, string> = {};
  upstream.res.headers.forEach((value, key) => {
    if (!skipHeaders.has(key.toLowerCase())) responseHeaders[key] = value;
  });

  return jsonOk(
    { status: upstream.res.status, headers: responseHeaders, body_b64: bytesToBase64(read.bytes) },
    cors,
  );
}

async function handleExtractArticle(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const secret = request.headers.get('X-Proxy-Secret') ?? '';
  // TEMP DEBUG — remove after diagnosing /extract-article 401 asymmetry.
  console.log('extract-article auth:', {
    gotPrefix: secret.slice(0, 4),
    expPrefix: (env.SHARED_SECRET ?? '').slice(0, 4),
    gotLen: secret.length,
    expLen: (env.SHARED_SECRET ?? '').length,
    match: secret === env.SHARED_SECRET,
  });
  if (secret !== env.SHARED_SECRET) return jsonError('Unauthorized', 401, cors);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be JSON', 400, cors);
  }
  const targetUrl = (body as { url?: unknown })?.url;
  if (typeof targetUrl !== 'string' || targetUrl.trim() === '') {
    return jsonError('Body must contain a non-empty "url" string', 400, cors);
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return jsonError('Invalid URL', 400, cors);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return jsonError('Only http and https URLs are allowed', 400, cors);
  }
  if (!checkAllowlist(env.URL_ALLOWLIST ?? '', targetUrl)) {
    return jsonError('url not allowed', 400, cors);
  }

  const upstream = await fetchWithLimits(parsed.toString());
  if (!upstream.ok) return jsonError(upstream.reason, 502, cors);
  if (upstream.res.status < 200 || upstream.res.status >= 300) {
    return jsonError(`Upstream returned ${upstream.res.status}`, 502, cors);
  }

  const read = await readBodyCapped(upstream.res);
  if (!read.ok) return jsonError(read.reason, 502, cors);

  const html = bytesToUtf8(read.bytes);
  const { document } = parseHTML(html);
  // @ts-expect-error linkedom's Document is structurally compatible with Readability's expectations.
  const parsedArticle = new Readability(document).parse();
  const fetchedAt = new Date().toISOString();

  if (!parsedArticle) {
    return jsonOk(
      { url: parsed.toString(), title: '', text: '', fetched_at: fetchedAt, note: 'could not extract main content' },
      cors,
    );
  }

  const title = (parsedArticle.title ?? '').trim();
  const text = (parsedArticle.textContent ?? '').trim();
  const note = text.length < SHORT_TEXT_THRESHOLD ? 'extracted body looked short' : undefined;

  const payload: Record<string, unknown> = {
    url: parsed.toString(),
    title,
    text,
    fetched_at: fetchedAt,
  };
  if (note !== undefined) payload.note = note;

  return jsonOk(payload, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN.trim() === '') {
      return jsonError('Worker misconfigured: ALLOWED_ORIGIN is not set', 500);
    }
    if (!env.SHARED_SECRET || env.SHARED_SECRET.trim() === '') {
      return jsonError('Worker misconfigured: SHARED_SECRET is not set', 500);
    }
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGIN);
    const requestOrigin = request.headers.get('Origin') ?? '';
    if (!allowedOrigins.includes(requestOrigin)) return jsonError('Origin not allowed', 403);
    const cors = corsHeaders(requestOrigin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/capabilities') {
      const secret = request.headers.get('X-Proxy-Secret') ?? '';
      if (secret !== env.SHARED_SECRET) return jsonError('Unauthorized', 401, cors);
      return jsonOk({ endpoints: ['/fetch', '/extract-article'] }, cors);
    }
    if (request.method === 'POST' && url.pathname === '/fetch') {
      return handleFetch(request, env, cors);
    }
    if (request.method === 'POST' && url.pathname === '/extract-article') {
      return handleExtractArticle(request, env, cors);
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
