/**
 * Minimum required bsky-saves CLI version. The GUI surfaces an upgrade prompt
 * when the running helper reports an older version. Bumped to 0.4.0 because
 * v0.4.0 added /fetch, /enrich, and /hydrate-threads endpoints that let the
 * GUI route those operations through the helper instead of Pyodide.
 *
 * (v0.3.1 had been the prior floor for the thread_schema_version 3 → 4 fix.)
 */
export const MIN_HELPER_VERSION = '0.4.0';

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
