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

function readFromStorage(): LastSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isLastSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeToStorage(session: LastSession | null): void {
  if (typeof sessionStorage === 'undefined') return;
  // Removal always goes through (sign-out / clear-all-data still need to
  // wipe the JWT pair from disk regardless of persistence mode).
  if (session === null) {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* best-effort */ }
    return;
  }
  // Session-only mode: keep the JWTs in memory but don't write them to
  // sessionStorage. Some browsers (Chrome with "Continue where you left
  // off", Firefox session restore) rehydrate sessionStorage across browser
  // quit, which would defeat the user's "don't keep anything" choice.
  if (!shouldPersistLibraryData()) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
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
