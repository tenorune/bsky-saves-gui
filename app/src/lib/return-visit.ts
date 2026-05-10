import { loadInventory } from './inventory-store';

/**
 * Decide where the user should land at app startup, given the URL
 * they arrived with. Returns:
 *   - null: keep them on the current URL.
 *   - a path: navigate them to it (callers pass animate: false since
 *     this is a cold-load decision, not a user-driven navigation).
 *
 * Handles two cases the URL alone can't answer:
 *   1. Cold load on the root with cached data → jump to /library so
 *      the user doesn't have to retype credentials.
 *   2. Cold load on a data-required route (/library, /post) with no
 *      data → fall back to sign-in. Without this, Library renders
 *      "First fetch in progress…" over a fundamentally empty state
 *      with no fetch actually running — typical reproducer is a
 *      session-only-mode user whose sessionStorage was wiped by the
 *      heartbeat-expiry on a long-gap browser reopen.
 *
 * Auxiliary routes (/settings, /privacy, not-found) are always
 * reachable on cold load and return null.
 */
export async function decideEntryRoute(hash: string = ''): Promise<string | null> {
  const inv = await loadInventory();

  if (hash === '' || hash === '#/') {
    return inv === null ? null : '/library';
  }

  if (hash === '#/library' || hash.startsWith('#/post/')) {
    return inv === null ? '/' : null;
  }

  return null;
}
