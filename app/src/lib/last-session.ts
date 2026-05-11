import { writable, type Readable } from 'svelte/store';
import { shouldPersistLibraryData } from './persistence-mode';
import { expireStaleSessionData } from './session-heartbeat';

const STORAGE_KEY = 'last-session:v1';

export interface LastSession {
  readonly pds: string;
  readonly accessJwt: string;
  readonly refreshJwt: string;
  readonly did: string;
  readonly handle: string;
}

function isLastSession(value: unknown): value is LastSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pds === 'string' &&
    typeof v.accessJwt === 'string' &&
    typeof v.refreshJwt === 'string' &&
    typeof v.did === 'string' &&
    typeof v.handle === 'string'
  );
}

function parse(raw: string | null): LastSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isLastSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read at module load. Two backings depending on mode:
 *   - Persist mode: localStorage. Survives across tabs, refresh, and
 *     browser quit. Signed-in state mirrors the saves' persistence.
 *   - Session-only mode: sessionStorage. Survives in-tab refresh and
 *     SPA navigation, drops on tab close, and is wiped by the heartbeat
 *     expiry (called below) when the user reopens the browser later.
 *
 * Run expireStaleSessionData FIRST so a stale heartbeat (browser quit
 * + later reopen) clears the session-only sessionStorage entry before
 * we read it. Without this, browsers with "Continue where you left off"
 * would auto-resume the user into the account against their intent.
 *
 * Then prefer sessionStorage over localStorage: a populated session-
 * only entry represents the current session's intent. A populated
 * localStorage entry represents persist mode. They shouldn't both be
 * set in normal flow (each write to one location clears the other) —
 * but if they are, sessionStorage wins as the more recent intent.
 */
function readFromStorage(): LastSession | null {
  expireStaleSessionData();
  if (typeof sessionStorage !== 'undefined') {
    try {
      const fromSession = parse(sessionStorage.getItem(STORAGE_KEY));
      if (fromSession !== null) return fromSession;
    } catch { /* ignore */ }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const fromLocal = parse(localStorage.getItem(STORAGE_KEY));
      if (fromLocal !== null) return fromLocal;
    } catch { /* ignore */ }
  }
  return null;
}

function writeToStorage(session: LastSession | null): void {
  // Removals always wipe BOTH stores so sign-out and Reset are
  // thorough regardless of which mode the user was in.
  if (session === null) {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* best-effort */ }
    }
    if (typeof sessionStorage !== 'undefined') {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* best-effort */ }
    }
    return;
  }
  // Each write also clears the OTHER store so a mode flip doesn't
  // leave a stale entry behind. Without this, saveLibraryToDevice
  // (session-only → persist promotion) would write to localStorage
  // while leaving the old sessionStorage value, and readFromStorage
  // would then return the stale sessionStorage one on next load.
  if (shouldPersistLibraryData()) {
    if (typeof sessionStorage !== 'undefined') {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* best-effort */ }
    }
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch { /* quota — fall through; in-memory store still works */ }
    return;
  }
  // Session-only: sessionStorage so refresh keeps the user signed in.
  // Heartbeat expiry (see readFromStorage) drops it after a real gap
  // in user presence.
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* best-effort */ }
  }
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch { /* quota — fall through */ }
}

const store = writable<LastSession | null>(readFromStorage());
export const lastSession: Readable<LastSession | null> = { subscribe: store.subscribe };

export function setLastSession(session: LastSession | null): void {
  store.set(session);
  writeToStorage(session);
}

export function clearLastSession(): void {
  setLastSession(null);
}
