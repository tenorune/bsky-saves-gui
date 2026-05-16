/**
 * Minimum required bsky-saves CLI version. The GUI surfaces an upgrade prompt
 * (OutdatedHelperBanner) when the running helper reports an older version.
 *
 * Bumped to 0.6.2 because that's the release that ships mandatory session-
 * token auth (`Authorization: Bearer <token>` required on every authed
 * endpoint, `WWW-Authenticate: Bearer` on pairing-cause 401s — see
 * docs/bsky-saves-gui-dist-workstream.md §4 items 11–13). The GUI's pairing
 * flow assumes those semantics; against helpers older than 0.6.2 the
 * pairing UI shows but never actually authenticates anything.
 *
 * Prior floors:
 *   0.4.1 — JWT-pair credentials path (`"jwt-credentials"` feature flag).
 *   0.4.0 — first wheel with /fetch, /enrich, /hydrate-threads.
 *   0.3.1 — thread_schema_version 3 → 4 fix.
 */
export const MIN_HELPER_VERSION = '0.6.2';

/**
 * Compare two semver-ish version strings. Returns true if `actual` is older
 * than the minimum. Treats non-numeric / missing segments as 0.
 */
export function isHelperOutdated(actual: string, min: string = MIN_HELPER_VERSION): boolean {
  const a = actual.split('.').map((n) => parseInt(n, 10) || 0);
  const b = min.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  return false;
}
