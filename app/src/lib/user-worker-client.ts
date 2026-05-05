// Client for a user-deployed Cloudflare Worker (templates/cf-worker/worker.js).
// The worker exposes POST /fetch which fetches a URL server-side and returns
// JSON with the base64-encoded body. We decode that into a Blob with the
// upstream Content-Type when known.

import type { ProxyConfig } from './proxy-config';

interface FetchEnvelope {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body_b64: string;
}

function isFetchEnvelope(v: unknown): v is FetchEnvelope {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.status === 'number' &&
    typeof r.headers === 'object' &&
    r.headers !== null &&
    typeof r.body_b64 === 'string'
  );
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Fetch a single image through a user-deployed cf-worker proxy. The worker
 * receives the URL via POST /fetch with the shared-secret header, fetches it
 * server-side, and returns base64-encoded bytes. We decode and wrap as a Blob.
 *
 * Throws on:
 *   - non-2xx response from the worker itself (auth failure, missing config)
 *   - non-2xx upstream status carried inside the envelope (404 from the CDN)
 *   - malformed JSON envelope
 *   - network failure
 */
export async function fetchImageViaUserWorker(
  config: ProxyConfig,
  imageUrl: string,
): Promise<Blob> {
  const base = config.url.replace(/\/+$/, '');
  const res = await fetch(`${base}/fetch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Secret': config.sharedSecret,
    },
    body: JSON.stringify({ url: imageUrl }),
  });
  if (!res.ok) {
    throw new Error(`user worker returned ${res.status}`);
  }
  const envelope = (await res.json()) as unknown;
  if (!isFetchEnvelope(envelope)) {
    throw new Error('user worker returned malformed JSON');
  }
  if (envelope.status < 200 || envelope.status >= 300) {
    throw new Error(`user worker reported upstream ${envelope.status}`);
  }
  const bytes = base64ToUint8(envelope.body_b64);
  const contentType =
    envelope.headers['content-type'] ??
    envelope.headers['Content-Type'] ??
    'application/octet-stream';
  return new Blob([bytes.slice().buffer], { type: contentType });
}

export class WorkerNoArticlesError extends Error {
  constructor() {
    super('worker does not support /extract-article');
    this.name = 'WorkerNoArticlesError';
  }
}

interface ExtractArticleResponse {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly fetched_at: string;
  readonly note?: string;
}

function isExtractArticleResponse(v: unknown): v is ExtractArticleResponse {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.url === 'string' &&
    typeof r.title === 'string' &&
    typeof r.text === 'string' &&
    typeof r.fetched_at === 'string' &&
    (r.note === undefined || typeof r.note === 'string')
  );
}

/**
 * Call the user worker's POST /extract-article endpoint.
 *
 * Throws:
 *   - WorkerNoArticlesError on 404 (old worker without article support)
 *   - Error("worker reported …") with the worker's error message on other non-2xx
 *   - Error("malformed JSON") when the response shape is wrong
 */
export async function extractArticleViaWorker(
  config: ProxyConfig,
  articleUrl: string,
): Promise<ExtractArticleResponse> {
  const base = config.url.replace(/\/+$/, '');
  const res = await fetch(`${base}/extract-article`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Secret': config.sharedSecret,
    },
    body: JSON.stringify({ url: articleUrl }),
  });
  if (res.status === 404) {
    throw new WorkerNoArticlesError();
  }
  if (!res.ok) {
    let reason = `user worker returned ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string') reason = body.error;
    } catch {
      // keep default reason
    }
    throw new Error(reason);
  }
  const body = (await res.json()) as unknown;
  if (!isExtractArticleResponse(body)) {
    throw new Error('user worker /extract-article returned malformed JSON');
  }
  return body;
}

/**
 * Probe the worker's GET /capabilities endpoint.
 * Returns true if the response lists "/extract-article". Returns false on
 * any failure (404, non-2xx, malformed body, network error) — the caller
 * conservatively treats anything ambiguous as "image-only worker".
 */
export async function probeWorkerCapabilities(
  url: string,
  sharedSecret: string,
): Promise<boolean> {
  const base = url.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/capabilities`, {
      method: 'GET',
      headers: { 'X-Proxy-Secret': sharedSecret },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { endpoints?: unknown };
    if (!Array.isArray(body.endpoints)) return false;
    return body.endpoints.includes('/extract-article');
  } catch {
    return false;
  }
}
