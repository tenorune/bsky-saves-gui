/**
 * Minimum required bsky-saves CLI version. The GUI surfaces an upgrade prompt
 * (OutdatedHelperBanner) when the running helper reports an older version.
 *
 * Bumped to 0.6.3 because that's the release that ships `GET /auth/check`,
 * the dedicated endpoint `probePairingToken` calls to verify a freshly-
 * pasted token before committing it to localStorage. Without 0.6.3 that
 * endpoint 404s and the pairing modal's verify probe silently fails as
 * "unreachable," misleading the user.
 *
 * Prior floors:
 *   0.6.2 — mandatory session-token auth + WWW-Authenticate: Bearer signal.
 *   0.4.1 — JWT-pair credentials path (`"jwt-credentials"` feature flag).
 *   0.4.0 — first wheel with /fetch, /enrich, /hydrate-threads.
 *   0.3.1 — thread_schema_version 3 → 4 fix.
 */
export const MIN_HELPER_VERSION = '0.6.3';

/**
 * Highest `protocol` value (from /ping) this GUI is built to talk to.
 * bsky-saves's protocol bumps when a request or response shape changes
 * in a non-additive way (workstream doc §4 item 13); new endpoints or
 * new optional fields don't bump it. When a helper reports a protocol
 * GREATER than this constant, the GUI knows it's missing endpoints /
 * fields the helper expects and surfaces ProtocolMismatchBanner with
 * an "update your GUI" prompt.
 *
 * Bumps land in the GUI release that adds support for the new protocol.
 * Today's value of "2" covers:
 *   1 — v0.6.0–v0.6.1 (no auth, extended /ping).
 *   2 — v0.6.2 (session-token auth, WWW-Authenticate: Bearer signal).
 */
export const MAX_KNOWN_PROTOCOL = '2';

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

/**
 * Return true if the helper's `protocol` (integer-as-string) is greater
 * than this GUI knows how to talk to. Comparison is numeric, not
 * lexicographic — "10" > "2", not "10" < "2".
 *
 * Non-numeric input is treated as 0, so a helper that returns a
 * non-numeric protocol (shouldn't happen per the spec, but we don't
 * trust the wire format) silently passes — better to under-report a
 * mismatch than over-report one and spam the banner on a transient
 * wire-format glitch.
 */
export function isProtocolNewerThanKnown(
  actual: string | null | undefined,
  max: string = MAX_KNOWN_PROTOCOL,
): boolean {
  if (typeof actual !== 'string') return false;
  const a = parseInt(actual, 10);
  const b = parseInt(max, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a > b;
}
