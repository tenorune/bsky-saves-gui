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
import { pairingToken, markPairingStale } from './pairing-token';

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

/**
 * True when the GUI is being served from the same origin as the helper —
 * the wheel-served (`bsky-saves serve --gui`) path. In that mode the
 * helper substitutes the `__BSKY_SAVES_TOKEN__` sentinel in `index.html`
 * with the current persistent token on every page load, so reloading
 * the page is itself the recovery from a stale-token 401.
 */
function isBundledGuiOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URL(window.location.href).origin === new URL(config.helperOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * Persistent budget for automatic page reloads on 401, capped at one per
 * 10s. Without a cap, a helper that keeps 401ing after reload (e.g.,
 * because the upstream PDS auth is broken, or the helper itself crashed)
 * would loop the page forever.
 */
const RELOAD_BUDGET_KEY = 'helper-401-reload-at:v1';
const RELOAD_COOLDOWN_MS = 10_000;

function consumeReloadBudget(): boolean {
  if (typeof localStorage === 'undefined' || typeof location === 'undefined') return false;
  try {
    const last = parseInt(localStorage.getItem(RELOAD_BUDGET_KEY) ?? '0', 10);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    localStorage.setItem(RELOAD_BUDGET_KEY, String(Date.now()));
  } catch {
    return false;
  }
  return true;
}

/**
 * React to a 401 from an authed helper endpoint.
 *
 * Distinguishes pairing-cause 401 from upstream-cause 401 via the
 * `WWW-Authenticate: Bearer` header — standard HTTP convention for
 * "this endpoint needs auth, your credentials were rejected." When the
 * header is absent we assume an upstream-cause 401 (helper proxied a
 * PDS auth failure) and don't touch the pairing state. This is
 * conservative: a helper that 401s for pairing reasons WITHOUT emitting
 * the header won't trigger automatic recovery, but it won't spuriously
 * flip pairingStale on upstream failures either. Swap the signal here
 * once bsky-saves PR #9 finalizes whatever convention they use.
 *
 * On a pairing-cause 401:
 *   - Bundled GUI (helper origin == window origin): reload the page;
 *     the helper will substitute a fresh token into `index.html`'s
 *     meta tag. Capped at one reload per 10s to avoid infinite loops
 *     if reload doesn't recover.
 *   - Hosted GUI: flip pairingStale; the PairingRequiredBanner takes
 *     over and prompts the user to re-paste from `bsky-saves token`.
 *
 * No-op when the request didn't carry an Authorization header (the GUI
 * was unpaired; no pairing state to mark stale).
 */
function handleAuthed401(res: Response, sentAuth: boolean): void {
  if (res.status !== 401 || !sentAuth) return;
  const challenge = res.headers.get('WWW-Authenticate');
  const isPairingChallenge =
    challenge !== null && challenge.toLowerCase().includes('bearer');
  if (!isPairingChallenge) return;
  if (isBundledGuiOrigin() && consumeReloadBudget()) {
    // Defer the reload so the current request's caller gets to reject
    // with its normal error message before navigation tears the page
    // down — keeps error logging coherent during the reload window.
    setTimeout(() => {
      if (typeof location !== 'undefined') location.reload();
    }, 100);
    return;
  }
  markPairingStale();
}

export type HelperStatus =
  | {
      status: 'available';
      version: string;
      features: readonly string[];
      /**
       * Stable compat-band integer-as-string. Bumps when an existing
       * endpoint changes in a non-additive way; new endpoints and new
       * optional fields don't bump it. Optional on the type because v0.6.0
       * helpers don't return it — only v0.6.1+ do (see
       * docs/bsky-saves-gui-dist-workstream.md §4 item 13).
       */
      protocol?: string;
      /**
       * The GUI tag whose `dist.tar.gz` was vendored into this helper at
       * wheel-build time. Matches `GUI_VERSION` in `bsky-saves`'s
       * `pyproject.toml`. `null` for dev installs that skipped the
       * GUI-fetch build hook. Optional on the type for backward compat
       * with v0.6.0 helpers that don't return the field at all.
       */
      gui_bundled?: string | null;
    }
  | { status: 'unavailable' };

interface PingPayload {
  readonly name: string;
  readonly version: string;
  readonly features: readonly string[];
  readonly protocol?: string;
  readonly gui_bundled?: string | null;
}

function isPingPayload(v: unknown): v is PingPayload {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (
    r.name !== 'bsky-saves' ||
    typeof r.version !== 'string' ||
    !Array.isArray(r.features) ||
    !r.features.every((f) => typeof f === 'string')
  ) {
    return false;
  }
  // Soft-validate the additive v0.6.1 fields: if present, the types must
  // match; if absent, the payload is still valid (v0.6.0 helpers in the
  // field don't ship them). Rejects payloads where the wheel returns the
  // field with the wrong type (e.g., a number instead of a string).
  if (r.protocol !== undefined && typeof r.protocol !== 'string') return false;
  if (
    r.gui_bundled !== undefined &&
    r.gui_bundled !== null &&
    typeof r.gui_bundled !== 'string'
  ) {
    return false;
  }
  return true;
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
      ...(body.protocol !== undefined ? { protocol: body.protocol } : {}),
      ...(body.gui_bundled !== undefined ? { gui_bundled: body.gui_bundled } : {}),
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
 * Probe a candidate pairing token against the helper. Returns:
 *   'valid'       — helper accepted the token (2xx response).
 *   'rejected'    — helper returned 401 / 403; the token is wrong.
 *   'unreachable' — network error, helper not running, CORS failure, etc.
 *
 * Implemented today as a no-op `POST /enrich` with an empty `uris[]` — the
 * helper returns `{enriched: [], errors: []}` for that input when auth
 * passes, 401 when the token is missing or wrong. This is a temporary
 * stand-in for the dedicated `/auth/check` endpoint proposed in the
 * bsky-saves session-token spec (PR #9). Swap when that lands.
 *
 * The token is passed explicitly rather than read from the pairing-token
 * store so the modal can verify a user's pasted token without committing
 * it to the store until the probe succeeds.
 */
export type PairingProbeResult = 'valid' | 'rejected' | 'unreachable';

export async function probePairingToken(
  origin: string,
  token: string,
): Promise<PairingProbeResult> {
  const base = origin.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ uris: [] }),
    });
  } catch {
    return 'unreachable';
  }
  if (res.ok) return 'valid';
  if (res.status === 401 || res.status === 403) return 'rejected';
  // Other 4xx/5xx: treat as unreachable (helper alive but misbehaving;
  // user can't fix this by re-pasting the token).
  return 'unreachable';
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
  const headers = withAuthHeaders({ 'Content-Type': 'application/json' });
  const sentAuth = 'Authorization' in headers;
  const res = await fetch(`${base}/fetch-image`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: imageUrl }),
  });
  handleAuthed401(res, sentAuth);
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
  const headers = withAuthHeaders({ 'Content-Type': 'application/json' });
  const sentAuth = 'Authorization' in headers;
  const res = await fetch(`${base}/extract-article`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: articleUrl }),
    signal: options.signal,
  });
  handleAuthed401(res, sentAuth);
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
  const headers = withAuthHeaders({ 'Content-Type': 'application/json' });
  const sentAuth = 'Authorization' in headers;
  const res = await fetch(`${base}/fetch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      credentials: serialiseCredentials(req.credentials),
      cursor: req.cursor,
      limit: req.limit,
    }),
  });
  handleAuthed401(res, sentAuth);
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
  const headers = withAuthHeaders({ 'Content-Type': 'application/json' });
  const sentAuth = 'Authorization' in headers;
  const res = await fetch(`${base}/enrich`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ uris: req.uris }),
  });
  handleAuthed401(res, sentAuth);
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
  const headers = withAuthHeaders({ 'Content-Type': 'application/json' });
  const sentAuth = 'Authorization' in headers;
  const res = await fetch(`${base}/hydrate-threads`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      uris: req.uris,
      credentials: serialiseCredentials(req.credentials),
    }),
  });
  handleAuthed401(res, sentAuth);
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
