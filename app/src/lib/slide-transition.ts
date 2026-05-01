import type { Action } from 'svelte/action';

export const slideFromRight: Action<HTMLElement> = (node) => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduce ? 120 : 280;
  const transform = reduce ? 'translateX(0)' : 'translateX(100%)';

  node.animate(
    [
      { transform, opacity: reduce ? 0 : 1 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    { duration, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'both' },
  );

  return {};
};
