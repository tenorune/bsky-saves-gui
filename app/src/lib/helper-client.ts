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
