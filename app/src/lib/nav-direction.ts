// Direction of a route → route navigation, used to pick a slide-in
// animation (forward = enters from right; backward = enters from left).
//
// Hierarchy:
//   sign-in (0) → library (1) → post (2) — this is the main reading flow.
//   Going up the level number = forward; going down = backward.
//
// Auxiliary routes (settings, privacy) live "below" the navbar conceptually
// — visiting them is always forward, leaving them is always backward,
// regardless of where you came from or where you're going next.

export type NavDirection = 'forward' | 'backward';

const HIERARCHY: Record<string, number> = {
  'sign-in': 0,
  library: 1,
  post: 2,
};

const AUXILIARY = new Set(['settings', 'privacy']);

export function decideNavDirection(fromName: string, toName: string): NavDirection {
  if (fromName === toName) return 'forward';

  // Auxiliary routes win: entering one is forward, leaving is backward.
  // (If both ends are auxiliary — e.g. settings → privacy — fall through
  // to the hierarchy rule, which will land on 'forward' since neither is
  // in the main hierarchy.)
  const fromAux = AUXILIARY.has(fromName);
  const toAux = AUXILIARY.has(toName);
  if (toAux && !fromAux) return 'forward';
  if (fromAux && !toAux) return 'backward';

  // Hierarchy comparison for the main reading flow.
  const fromLevel = HIERARCHY[fromName];
  const toLevel = HIERARCHY[toName];
  if (fromLevel !== undefined && toLevel !== undefined) {
    return toLevel >= fromLevel ? 'forward' : 'backward';
  }

  // Anything outside the model (not-found, an aux→aux jump, etc.) — default
  // forward so the user sees the standard "new content arrives" motion.
  return 'forward';
}
