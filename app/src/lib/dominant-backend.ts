import type { CapabilitySnapshot } from './capability-snapshot';

/**
 * Returns a human-readable name for the dominant backend across the three
 * asset paths (threads/images/articles), or null if there's no clear majority.
 *
 * "Dominant" means "all three use the same backend kind". Otherwise we let
 * per-row labels do the talking.
 */
export function computeDominantBackend(snap: CapabilitySnapshot): string | null {
  const kinds = [snap.threads.kind, snap.images.kind, snap.articles.kind];
  const allSame = kinds.every((k) => k === kinds[0]);
  if (!allSame) return null;
  return labelFor(kinds[0]);
}

function labelFor(kind: string): string | null {
  switch (kind) {
    case 'helper': return 'local helper';
    case 'user-worker': return 'your worker proxy';
    case 'operator-worker': return "operator's worker proxy";
    case 'pyodide': return null; // Pyodide is implicit fallback; don't surface
    case 'none': return null;
    default: return null;
  }
}

/**
 * Per-row prospective backend name for OFF-state tooltips and Settings
 * inline labels. Returns the user-facing name of the proxy the asset
 * WOULD route through (or currently does) — only for the proxy kinds
 * worth surfacing.
 *
 * Returns null for 'helper' and 'pyodide' (implicit "it just works" cases
 * the user doesn't need to think about) and for 'none' (callers handle the
 * "no backend available" case separately, with a Set-up affordance).
 */
export function prospectiveBackendName(kind: string): string | null {
  switch (kind) {
    case 'user-worker': return 'your worker proxy';
    case 'operator-worker': return "operator's worker proxy";
    default: return null;
  }
}
