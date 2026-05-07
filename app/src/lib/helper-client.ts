// Client for the local bsky-saves serve daemon. Speaks the API specified in
// docs/bsky-saves-serve-requirements.md: GET /ping for capability detection,
// POST /fetch-image for byte fetching (added in a later plan).

import { config } from './config';

export type HelperStatus =
  | { status: 'available'; version: string; features: readonly string[] }
  | { status: 'unavailable' };

interface PingPayload {
  readonly name: string;
  readonly version: string;
  readonly features: readonly string[];
}

function isPingPayload(v: unknown): v is PingPayload {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    r.name === 'bsky-saves' &&
    typeof r.version === 'string' &&
    Array.isArray(r.features) &&
    r.features.every((f) => typeof f === 'string')
  );
}

/**
 * Probe the helper daemon at the given origin. Resolves with a capability
 * report when the daemon is reachable and identifies as bsky-saves; otherwise
 * resolves with `{ status: 'unavailable' }`.
 *
 * Never throws.
 */
export async function probeHelper(origin: string): Promise<HelperStatus> {
  const base = origin.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/ping`, { method: 'GET' });
    if (!res.ok) return { status: 'unavailable' };
    const body = (await res.json()) as unknown;
    if (!isPingPayload(body)) return { status: 'unavailable' };
    return {
      status: 'available',
      version: body.version,
      features: body.features,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Probe the configured helper origin (`VITE_HELPER_ORIGIN`).
 */
export function probeConfiguredHelper(): Promise<HelperStatus> {
  return probeHelper(config.helperOrigin);
}

/**
 * Lightweight reachability check: returns true if the helper's /ping responds
 * with any 2xx status. Returns false on any non-2xx or network error.
 *
 * Never throws.
 */
export async function pingHelper(origin: string): Promise<boolean> {
  const base = origin.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch a single image via the local helper's POST /fetch-image endpoint.
 * The helper does the outbound HTTP from the user's machine and streams the
 * raw bytes back. Throws on non-2xx response or network error.
 */
export async function fetchImageViaHelper(origin: string, imageUrl: string): Promise<Blob> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/fetch-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl }),
  });
  if (!res.ok) {
    throw new Error(`helper /fetch-image returned ${res.status}`);
  }
  return res.blob();
}

export interface ExtractedArticle {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly fetched_at: string;
  readonly note?: string;
}

function isExtractedArticle(v: unknown): v is ExtractedArticle {
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
 * Extract an article via the local helper's POST /extract-article endpoint.
 * Returns title + text + metadata. Throws on non-2xx, malformed envelope, or
 * network failure.
 */
export async function extractArticleViaHelper(
  origin: string,
  articleUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<ExtractedArticle> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/extract-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: articleUrl }),
    signal: options.signal,
  });
  if (!res.ok) {
    throw new Error(`helper /extract-article returned ${res.status}`);
  }
  const body = (await res.json()) as unknown;
  if (!isExtractedArticle(body)) {
    throw new Error('helper /extract-article returned malformed JSON');
  }
  return body;
}

export type AppPasswordCredentials = {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
};

export type JwtPairCredentials = {
  readonly accessJwt: string;
  readonly refreshJwt: string;
  readonly did: string;
  readonly pds?: string;
};

export type FetchSavesCredentials = AppPasswordCredentials | JwtPairCredentials;

export interface FetchSavesRequest {
  readonly credentials: FetchSavesCredentials;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface FetchSavesResponse {
  readonly saves: readonly unknown[];
  readonly cursor: string | null;
  readonly rotated_credentials?: {
    readonly access_jwt: string;
    readonly refresh_jwt: string;
    readonly did: string;
  };
}

function isAppPassword(c: FetchSavesCredentials): c is AppPasswordCredentials {
  return 'appPassword' in c;
}

function serialiseCredentials(c: FetchSavesCredentials): Record<string, string> {
  if (isAppPassword(c)) {
    return { handle: c.handle, app_password: c.appPassword, pds: c.pds };
  }
  return {
    access_jwt: c.accessJwt,
    refresh_jwt: c.refreshJwt,
    did: c.did,
    ...(c.pds ? { pds: c.pds } : {}),
  };
}

export async function fetchSaves(
  origin: string,
  req: FetchSavesRequest,
): Promise<FetchSavesResponse> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credentials: serialiseCredentials(req.credentials),
      cursor: req.cursor,
      limit: req.limit,
    }),
  });
  if (!res.ok) {
    let msg = `helper /fetch returned ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return await res.json() as FetchSavesResponse;
}
