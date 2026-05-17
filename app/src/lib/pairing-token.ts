// Pairing token: the per-helper-install secret the GUI sends in the
// `Authorization: Bearer <token>` header on every authed request to
// the local helper (`/fetch`, `/enrich`, `/hydrate-threads`,
// `/fetch-image`, `/extract-article`). `/ping` is exempt — see
// docs/bsky-saves-gui-dist-workstream.md §4 item 13.
//
// Two acquisition paths the GUI tolerates:
//
// 1. Wheel-served (`bsky-saves serve --gui`). The helper substitutes
//    the `__BSKY_SAVES_TOKEN__` sentinel in the served `index.html`
//    with the user's persistent token (stored in their helper's
//    config dir). The GUI reads the meta tag at startup — zero
//    friction, the user never sees the token.
//
// 2. Hosted-PWA (`saves.lightseed.net`). The literal sentinel reaches
//    the browser unsubstituted (no helper involved in serving the
//    page). The GUI detects that, leaves the state at 'unpaired',
//    and the user manually runs `bsky-saves token` in a terminal to
//    print the persistent token, then pastes it into the GUI's
//    pairing modal. The pasted value persists in localStorage so
//    they don't re-paste on every browser session.
//
// State transitions:
//   unpaired → paired   (user pastes a valid token, or meta tag holds one)
//   paired   → stale    (helper returned 401 — token rotated or invalidated)
//   stale    → paired   (user pastes a fresh token)
//   any      → unpaired (Settings → Clear data, or token clobbered)

import { writable, type Readable } from 'svelte/store';

const STORAGE_KEY = 'bsky-saves-pairing-token:v1';
const SENTINEL = '__BSKY_SAVES_TOKEN__';
const META_NAME = 'bsky-saves-token';

export type PairingState = 'unpaired' | 'paired' | 'stale';

export interface PairingTokenState {
  readonly state: PairingState;
  readonly token: string | null;
}

const DEFAULT: PairingTokenState = { state: 'unpaired', token: null };

const store = writable<PairingTokenState>(DEFAULT);
export const pairingToken: Readable<PairingTokenState> = { subscribe: store.subscribe };

/**
 * Validate that a string looks like a base64url-encoded token of the
 * length we expect from `bsky-saves` (`secrets.token_urlsafe(N)` for
 * N=16..48 produces ~22..64 chars). Rejects the unsubstituted sentinel
 * explicitly so a saves.lightseed.net page-load doesn't accidentally
 * authenticate as `__BSKY_SAVES_TOKEN__`.
 */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const MIN_TOKEN_LEN = 22;
const MAX_TOKEN_LEN = 64;

export function isValidTokenShape(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value === SENTINEL) return false;
  if (value.length < MIN_TOKEN_LEN || value.length > MAX_TOKEN_LEN) return false;
  return BASE64URL_RE.test(value);
}

/**
 * Hydrate the store at app startup. Order of precedence:
 *
 *   1. `<meta name="bsky-saves-token">` content — set by the helper
 *      in `--gui` mode. Highest authority; overrides any stale value
 *      a previous browser session left in localStorage.
 *   2. `localStorage[bsky-saves-pairing-token:v1]` — set by the user
 *      via the pairing modal on a previous visit.
 *   3. Nothing — leave the state at the default 'unpaired'. The GUI's
 *      helper-routed paths will 401 on first use and the
 *      PairingRequiredBanner takes over.
 *
 * Synchronous so the first render after `new App({...})` sees the
 * correct state without a flash of "paired" → "unpaired" or vice versa.
 */
export function initPairingToken(): void {
  // Path 1: meta tag.
  if (typeof document !== 'undefined') {
    const meta = document.querySelector(`meta[name="${META_NAME}"]`);
    const rawContent = meta?.getAttribute('content');
    // Diagnostic FIRST (so TypeScript's narrowing after the type-guard
    // call doesn't strip the string union off `rawContent`): a meta tag
    // is PRESENT but the value didn't shape-match. Two expected cases
    // that should NOT warn:
    //   - The hosted PWA at saves.lightseed.net reaches the GUI with
    //     the literal sentinel because no helper is in the request path.
    //     That's the documented unpaired-startup behavior, not a fault.
    //   - The tag is absent entirely (jsdom unit-test setups, older
    //     hand-rolled deployments).
    // Anything else means either (a) the helper didn't substitute, or
    // (b) the helper produced a token shape this GUI doesn't recognize
    // (e.g., a future bsky-saves bumped MIN/MAX token length or alphabet
    // beyond our regex). Surface it to the console so the next bug
    // report includes specifics instead of "the modal just opens".
    // Length only; we don't log the value itself even when it failed
    // validation — it might still be a real secret.
    const contentLength = typeof rawContent === 'string' ? rawContent.length : -1;
    if (
      meta !== null &&
      typeof rawContent === 'string' &&
      rawContent !== SENTINEL &&
      !isValidTokenShape(rawContent)
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `[bsky-saves] meta[name="${META_NAME}"] present but content failed pairing-token shape validation. ` +
          `Pairing UI may prompt the user despite the helper's substitution. ` +
          `Open a GUI issue with these details:`,
        { length: contentLength, allowedRange: [MIN_TOKEN_LEN, MAX_TOKEN_LEN] },
      );
    }
    if (isValidTokenShape(rawContent)) {
      store.set({ state: 'paired', token: rawContent });
      return;
    }
  }
  // Path 2: localStorage.
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isValidTokenShape(stored)) {
        store.set({ state: 'paired', token: stored });
        return;
      }
    } catch {
      /* localStorage access denied (private mode in some browsers) — ignore. */
    }
  }
  // Path 3: leave default.
}

/**
 * Persist a user-pasted token. Validates the shape; throws if the
 * caller hands in something that doesn't look like a base64url token
 * of the expected length. The pairing modal calls this only after its
 * verify probe has succeeded, so the shape check here is defense in
 * depth, not the primary gate.
 */
export function setPairingToken(token: string): void {
  if (!isValidTokenShape(token)) {
    throw new Error('Pairing token does not look like a base64url string.');
  }
  store.set({ state: 'paired', token });
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* Quota-exceeded / private mode — token survives this session in
         memory but won't persist. Acceptable degraded state. */
    }
  }
}

/**
 * Drop the stored token entirely. Wired into Settings → Clear data so
 * a full local-state wipe also forgets the helper pairing. Resets the
 * state to 'unpaired' (not 'stale') because the user explicitly asked
 * to start over.
 */
export function clearPairingToken(): void {
  store.set({ state: 'unpaired', token: null });
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Flip 'paired' → 'stale' when an authed endpoint returns 401. Idempotent:
 * a request from 'stale' state stays stale; a request from 'unpaired' stays
 * unpaired (the banner is already prompting; no point flapping the state
 * onward). The token itself is preserved across the flip so the modal can
 * prefill or so we can keep sending it (the helper will keep 401ing, which
 * is fine — request-side cost is negligible compared to a re-pair).
 */
export function markPairingStale(): void {
  store.update((cur) => (cur.state === 'paired' ? { ...cur, state: 'stale' } : cur));
}

/** For tests only — resets to default without touching localStorage. */
export function _resetPairingTokenForTests(): void {
  store.set(DEFAULT);
}
