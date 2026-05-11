import type { Action } from 'svelte/action';
import { getAndConsumeInAppNav, getLastNavDirection } from './router';

// Slide-in animation for a route component on mount. Direction comes from
// the router (decided at navigation time): 'forward' enters from the right
// (the established motion); 'backward' enters from the left.
//
// Skipped when the route mount is NOT the result of in-app navigation
// (cold load, page reload, address-bar edit, browser back/forward).
// The animation is intended only as feedback for "you just clicked
// something inside the app," so the URL-driven entry points should land
// silently — the user already saw the URL change.
export const slideRoute: Action<HTMLElement> = (node) => {
  if (!getAndConsumeInAppNav()) return {};

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduce ? 120 : 280;
  const direction = getLastNavDirection();
  const startX = reduce ? '0' : direction === 'forward' ? '100%' : '-100%';

  node.animate(
    [
      { transform: `translateX(${startX})`, opacity: reduce ? 0 : 1 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    { duration, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' },
  );

  return {};
};

// Backwards-compatible alias for the original always-from-the-right action.
// Existing call sites (Library, Post) kept this name; new sites should
// prefer `slideRoute`. They behave identically — the action reads the
// router's last direction either way.
export const slideFromRight = slideRoute;
