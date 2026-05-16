// Client for the local bsky-saves serve daemon. Speaks the API specified in
// docs/bsky-saves-serve-requirements.md: GET /ping for capability detection,
// POST /fetch-image for byte fetching (added in a later plan).
//
// Auth model (docs/bsky-saves-gui-dist-workstream.md §4 item 11): every
// endpoint EXCEPT /ping requires `Authorization: Bearer <token>` once the
// helper ships token enforcement. Until then, the header is harmless if
// the helper ignores it; if the helper enforces it, an unpaired GUI will
// 401 and the PairingRequiredBanner UX takes over.
//
// 401-driven `markPairingStale` is intentionally NOT wired here yet — a
// 401 from /fetch can mean either "GUI's pairing token is bad" OR "the
// helper proxied an upstream PDS auth failure" (see existing tests under
// "throws on 401 createSession failed"). Differentiating needs the
// helper-side signal from bsky-saves PR #9 (probably WWW-Authenticate:
// Bearer or a typed error body). Deferring until that lands; the initial
// pairing flow (unpaired-on-startup → user pastes → paired) works without it.

import { get } from 'svelte/store';
import { config } from './config';
import { pairingToken } from './pairing-token';

/**
 * Add `Authorization: Bearer <token>` to `headers` if the pairing store
 * holds a token (state 'paired' or 'stale' — we keep sending the stale
 * token because the helper will keep 401ing, which is cheap and stable).
 * No-op when the GUI is unpaired.
 */
function withAuthHeaders(headers: Record<string, string>): Record<string, string> {
  const { state, token } = get(pairingToken);
  if (token !== null && state !== 'unpaired') {
    return { ...headers, Authorization: `Bearer ${token}` };
  }
  return headers;
}

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
// 25 MB cap: comfortably larger than any Bluesky image / video thumbnail
// while preventing a misbehaving or compromised helper from filling the
// page's memory with arbitrary bytes.
const HELPER_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export async function fetchImageViaHelper(origin: string, imageUrl: string): Promise<Blob> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/fetch-image`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url: imageUrl }),
  });
  if (!res.ok) {
    throw new Error(`helper /fetch-image returned ${res.status}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/') && !contentType.startsWith('application/octet-stream')) {
    throw new Error(`helper /fetch-image returned non-image content-type: ${contentType}`);
  }
  const contentLength = res.headers.get('content-length');
  if (contentLength !== null) {
    const announced = parseInt(contentLength, 10);
    if (Number.isFinite(announced) && announced > HELPER_IMAGE_MAX_BYTES) {
      throw new Error(`helper /fetch-image announced ${announced} bytes (cap ${HELPER_IMAGE_MAX_BYTES})`);
    }
  }
  const blob = await res.blob();
  if (blob.size > HELPER_IMAGE_MAX_BYTES) {
    throw new Error(`helper /fetch-image returned ${blob.size} bytes (cap ${HELPER_IMAGE_MAX_BYTES})`);
  }
  return blob;
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
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
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
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
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

export interface EnrichRequest {
  readonly uris: readonly string[];
}

export interface EnrichEntry {
  readonly uri: string;
  readonly post_created_at: string;
}

export interface EnrichErrorEntry {
  readonly uri: string;
  readonly reason: string;
}

export interface EnrichResponse {
  readonly enriched: readonly EnrichEntry[];
  readonly errors: readonly EnrichErrorEntry[];
}

export async function enrichUris(origin: string, req: EnrichRequest): Promise<EnrichResponse> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/enrich`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ uris: req.uris }),
  });
  if (!res.ok) {
    let msg = `helper /enrich returned ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return await res.json() as EnrichResponse;
}

export interface HydrateThreadsRequest {
  readonly uris: readonly string[];
  readonly credentials: FetchSavesCredentials;
}

export interface ThreadEntry {
  readonly uri: string;
  readonly thread_replies: readonly unknown[];
  readonly thread_schema_version: number;
  readonly thread_fetched_at: string;
}

export interface ThreadErrorEntry {
  readonly uri: string;
  readonly reason: string;
}

export interface HydrateThreadsResponse {
  readonly threaded: readonly ThreadEntry[];
  readonly errors: readonly ThreadErrorEntry[];
}

export async function hydrateThreads(
  origin: string,
  req: HydrateThreadsRequest,
): Promise<HydrateThreadsResponse> {
  const base = origin.replace(/\/+$/, '');
  const res = await fetch(`${base}/hydrate-threads`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      uris: req.uris,
      credentials: serialiseCredentials(req.credentials),
    }),
  });
  if (!res.ok) {
    let msg = `helper /hydrate-threads returned ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return await res.json() as HydrateThreadsResponse;
}
