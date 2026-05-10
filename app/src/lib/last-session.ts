import { writable, type Readable } from 'svelte/store';
import { shouldPersistLibraryData } from './persistence-mode';

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
 * Read at module load. Persist mode keeps the JWT pair in localStorage
 * so it survives single-tab close (sessionStorage's per-tab scope was
 * always the wrong shape for "session" in the user-facing sense:
 * closing one tab shouldn't sign the user out across other tabs or a
 * later reopen). On first load after the migration, fall back to
 * sessionStorage so an existing user doesn't get logged out and
 * promote the value to localStorage.
 */
function readFromStorage(): LastSession | null {
  // Try localStorage first.
  if (typeof localStorage !== 'undefined') {
    try {
      const fromLocal = parse(localStorage.getItem(STORAGE_KEY));
      if (fromLocal !== null) return fromLocal;
    } catch { /* ignore */ }
  }
  // One-time migration: a value left over in sessionStorage from before
  // the localStorage move. Promote it.
  if (typeof sessionStorage !== 'undefined') {
    try {
      const fromSession = parse(sessionStorage.getItem(STORAGE_KEY));
      if (fromSession !== null) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(fromSession));
          }
          sessionStorage.removeItem(STORAGE_KEY);
        } catch { /* ignore */ }
        return fromSession;
      }
    } catch { /* ignore */ }
  }
  return null;
}

function writeToStorage(session: LastSession | null): void {
  // Removals always go through — sign-out and Reset must wipe the JWT
  // pair from BOTH stores regardless of mode (sessionStorage may still
  // have a stale value during the migration window above).
  if (session === null) {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* best-effort */ }
    }
    if (typeof sessionStorage !== 'undefined') {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* best-effort */ }
    }
    return;
  }
  // In session-only mode, the JWT pair is kept in the in-memory svelte
  // store but NOT mirrored to disk. The in-memory store dies with the
  // page, so signed-in state genuinely doesn't survive browser quit,
  // even on browsers that restore sessionStorage via their "Continue
  // where you left off" feature.
  if (!shouldPersistLibraryData()) return;
  // Persist mode: write to localStorage so signed-in state mirrors the
  // saves (which live in IDB). Closing one tab no longer signs the
  // user out across other tabs / later reopens.
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Quota or disabled storage — fall through; in-memory store still works.
  }
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
