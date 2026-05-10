import { loadInventory } from './inventory-store';

/**
 * Decide where the user should land at app startup, given the URL
 * they arrived with. Returns:
 *   - null: keep them on the current URL.
 *   - a path: navigate them to it (callers pass animate: false since
 *     this is a cold-load decision, not a user-driven navigation).
 *
 * Session state is intentionally NOT consulted: the cached Library
 * is browse-able even when the user is signed out (their saves are
 * local data they should be able to read offline). Refreshing the
 * inventory requires sign-in, but viewing it does not.
 *
 * Two cases the URL alone can't answer:
 *   1. Cold load on the root with cached data → jump to /library so
 *      the user doesn't have to retype credentials.
 *   2. Cold load on a data-required route (/library, /post) with no
 *      data → fall back to sign-in. Without this, Library renders
 *      "First fetch in progress…" over a fundamentally empty state.
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
