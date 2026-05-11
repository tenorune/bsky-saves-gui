// In-memory snapshot of the Library route's window scroll position. The
// router unmounts the Library component when navigating into a post (and
// re-mounts it on return), which would otherwise reset scroll to the top.
// Library.svelte calls saveLibraryScroll() right before navigating into a
// post, and consumes the value on mount once the inventory has rendered.
//
// Cleared on consume so a follow-up navigation from somewhere other than a
// post (e.g., Settings → Library) starts at the top instead of jumping to
// a stale position.
let savedY: number | null = null;

export function saveLibraryScroll(): void {
  if (typeof window === 'undefined') return;
  savedY = window.scrollY;
}

export function consumeLibraryScroll(): number | null {
  const y = savedY;
  savedY = null;
  return y;
}

/**
 * Discard any saved scroll position without consuming it. Use when the
 * user explicitly chooses to navigate to the top of the Library — e.g.,
 * the "Library" link in a post's backup-status footer — so the next
 * Library mount lands at the top instead of jumping to a stale per-card
 * scroll position from the previous Library visit.
 */
export function clearLibraryScroll(): void {
  savedY = null;
}

/** For tests only. */
export function _resetLibraryScrollForTests(): void {
  savedY = null;
}
