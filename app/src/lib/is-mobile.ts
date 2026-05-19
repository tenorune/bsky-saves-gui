// Conservative mobile-OS detector. We use this only to hide UI that is
// meaningless on a phone/tablet — the local-helper hint, the
// "Use the local helper from this browser" Settings checkbox — because
// installing Python + binding a loopback port is a desktop-only path.
//
// False negatives (mobile shown desktop UI) are tolerable: same noise the
// app has shipped with for releases. False POSITIVES (desktop misclassified
// as mobile) would silently strip helper UI from a desktop user who could
// genuinely use it. Bias accordingly — only return true when the UA / UA
// hints unambiguously identify a mobile OS.

/** Subset of the Navigator interface we read. Lets tests pass a literal. */
export interface NavigatorLike {
  readonly userAgent?: string;
  readonly userAgentData?: { readonly mobile?: boolean };
  readonly maxTouchPoints?: number;
}

/**
 * Pure form of {@link isMobileOs}. Takes a Navigator-like literal so tests
 * don't have to mutate the real `navigator` global. Same logic, no I/O.
 */
export function checkIsMobileOs(nav: NavigatorLike): boolean {
  // Modern Chromium (Android, ChromeOS, desktop): User-Agent Client Hints
  // surface a curated `mobile` boolean. When present and true, trust it —
  // the browser is asserting "I'm running on a phone-form-factor device".
  // (Tablets typically return false here, which is why we ALSO fall through
  // to UA-string matching below.)
  if (nav.userAgentData && nav.userAgentData.mobile === true) return true;

  const ua = nav.userAgent ?? '';
  if (ua === '') return false;

  // Phones, iPads reporting honestly, Android tablets. The classic UA-string
  // markers — stable across browser engines and versions.
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;

  // iPadOS 13+ Safari spoofs the desktop Mac UA by default. The single
  // discriminator left is touch points: a real Mac reports 0; an iPad
  // reports > 1. Require > 1 (not >= 1) so a Mac trackpad single-touch
  // edge case doesn't flip a desktop user into the mobile bucket.
  if (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return true;

  return false;
}

/**
 * Read the live `navigator` (when present in the runtime) and classify.
 * Returns false in SSR / Node contexts where there's no navigator —
 * jsdom-driven tests can still drive {@link checkIsMobileOs} directly.
 */
export function isMobileOs(): boolean {
  if (typeof navigator === 'undefined') return false;
  return checkIsMobileOs(navigator as NavigatorLike);
}
