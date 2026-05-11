// Heartbeat-based expiry for session-only data.
//
// The asymmetry we're solving: session-only data lives in sessionStorage,
// which is per-tab so closing one tab destroys it, BUT browsers with
// session-restore enabled rehydrate sessionStorage across browser quit
// — so quitting and reopening the browser keeps the Library indefinitely
// (until manual clear). The lighter action (close one tab) is more
// destructive than the heavier action (quit browser).
//
// Mechanism: while the page is alive, write a heartbeat timestamp to
// localStorage every HEARTBEAT_INTERVAL_MS (and on page-life signals:
// visibilitychange, focus, pagehide — Chrome throttles setInterval in
// background tabs, so events catch what the timer misses). On any cold
// page load, before reading session-only data, check the heartbeat: if
// it's older than STALE_THRESHOLD_MS, the user has been gone long
// enough that we treat the session as expired and clear all session-
// only sessionStorage entries.
//
// Refresh: heartbeat is at most HEARTBEAT_INTERVAL_MS old → fresh →
// data preserved.
// Quit browser, reopen quickly (≤ STALE_THRESHOLD_MS): residual gap
// where data is still preserved. Irreducible without giving up refresh
// preservation, since JS can't reliably distinguish a tab close from a
// refresh.
// Quit browser, reopen later: heartbeat stale → cleared.

const HEARTBEAT_KEY = 'session-heartbeat:v1';

// Time between scheduled writes. Short enough that refresh always wins,
// long enough not to be wasteful.
const HEARTBEAT_INTERVAL_MS = 30_000;

// How old the heartbeat can be before we treat the session as expired.
// Must be greater than HEARTBEAT_INTERVAL_MS plus headroom for browser
// throttling (Chrome throttles setInterval to ~1/min for backgrounded
// tabs; visibilitychange + focus listeners catch most of that).
const STALE_THRESHOLD_MS = 60_000;

// Sessionstorage keys that should be cleared when the heartbeat is
// stale. Add new session-only keys here as they're introduced — the
// list represents "everything tied to the current session that should
// be wiped if the user has been gone long enough."
const SESSION_KEYS_TO_EXPIRE = [
  'inventory:session-v1',  // inventory-store
  'inventory-present:v1',  // inventory-presence
  'last-session:v1',       // last-session (session-only mode)
  'account:v1',            // account-store (session-only mode)
  'session-only-mode:v1',  // persistence-mode marker — wiping it lets
                           // the post-expiry app revert to default
                           // 'persist' mode and stop showing the
                           // session-only banner over a fresh state
];

let intervalId: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;

function writeHeartbeat(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
  } catch {
    // Quota or disabled storage — best-effort.
  }
}

function readHeartbeatMs(): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    if (raw === null) return null;
    const ms = parseInt(raw, 10);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Whether the heartbeat is recent enough that we consider the session
 * still active. Returns true if no heartbeat exists yet (first-ever
 * load or post-clear) so the caller doesn't preemptively expire data
 * that simply hasn't been accompanied by a heartbeat yet.
 */
export function isSessionFresh(): boolean {
  const last = readHeartbeatMs();
  if (last === null) return true;
  return Date.now() - last <= STALE_THRESHOLD_MS;
}

/**
 * Clear all session-only sessionStorage entries when the heartbeat is
 * stale. Called by inventory-store and inventory-presence at their
 * read-time entry points so any data restored by a session-restoring
 * browser is wiped before it can reach the UI. Returns true if a
 * cleanup ran.
 */
export function expireStaleSessionData(): boolean {
  if (isSessionFresh()) return false;
  if (typeof sessionStorage === 'undefined') return false;
  for (const key of SESSION_KEYS_TO_EXPIRE) {
    try { sessionStorage.removeItem(key); } catch { /* best-effort */ }
  }
  return true;
}

export function startSessionHeartbeat(): void {
  if (intervalId !== null) return;
  writeHeartbeat();
  intervalId = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  if (!listenersBound && typeof window !== 'undefined') {
    // Fire on user-activity signals so a heavily-throttled background
    // tab still updates the heartbeat when the user comes back.
    document.addEventListener('visibilitychange', writeHeartbeat);
    window.addEventListener('focus', writeHeartbeat);
    // pagehide fires on tab close, refresh, and SPA navigation away —
    // capturing one last "I was here just now" so a quick reopen
    // doesn't see a stale heartbeat.
    window.addEventListener('pagehide', writeHeartbeat);
    listenersBound = true;
  }
}

export function stopSessionHeartbeat(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Remove the heartbeat key entirely. Called when the user promotes
 * out of session-only mode (Save Library to this device) or wipes
 * everything (Settings → Reset).
 */
export function clearSessionHeartbeat(): void {
  stopSessionHeartbeat();
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(HEARTBEAT_KEY); } catch { /* best-effort */ }
}

// Test helper — exposed read of the constants without re-deriving.
export const _internals = {
  HEARTBEAT_KEY,
  HEARTBEAT_INTERVAL_MS,
  STALE_THRESHOLD_MS,
  SESSION_KEYS_TO_EXPIRE,
};
