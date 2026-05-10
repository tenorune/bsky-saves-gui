import { loadInventory } from './inventory-store';
import type { LastSession } from './last-session';

/**
 * Decide where the user should land at app startup, given the URL
 * they arrived with and their current sign-in state. Returns:
 *   - null: keep them on the current URL.
 *   - a path: navigate them to it (callers pass animate: false since
 *     this is a cold-load decision, not a user-driven navigation).
 *
 * Handles three cases the URL alone can't answer:
 *   1. Cold load on the root with cached data AND an active session →
 *      jump to /library so the user doesn't have to retype credentials.
 *   2. Cold load on a data-required route (/library, /post) with no
 *      data → fall back to sign-in. Without this, Library renders
 *      "First fetch in progress…" over a fundamentally empty state.
 *   3. Cold load on a data-required route with no active session →
 *      fall back to sign-in too, even if cached data exists; without
 *      a session the user can't refresh the data and the cached state
 *      is a dead end.
 *
 * Auxiliary routes (/settings, /privacy, not-found) are always
 * reachable on cold load and return null.
 */
export async function decideEntryRoute(
  hash: string = '',
  session: LastSession | null = null,
): Promise<string | null> {
  const inv = await loadInventory();

  if (hash === '' || hash === '#/') {
    // Auto-resume into /library only if the user has BOTH cached data
    // and a live session.
    return inv !== null && session !== null ? '/library' : null;
  }

  if (hash === '#/library' || hash.startsWith('#/post/')) {
    return inv === null || session === null ? '/' : null;
  }

  return null;
}
