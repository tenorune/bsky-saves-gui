import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { signInDraft } from './sign-in-draft';
import {
  lastSession,
  setLastSession,
  clearLastSession,
} from './last-session';

const SAMPLE = {
  pds: 'https://x',
  accessJwt: 'a',
  refreshJwt: 'r',
  did: 'd',
  handle: 'h',
};

const PERSIST_DRAFT = {
  handle: 'a',
  appPassword: 'b',
  pds: 'https://x',
  saveInventory: true,
  saveCredentials: false,
  passphrase: '',
};

const SESSION_ONLY_DRAFT = { ...PERSIST_DRAFT, saveInventory: false };

// Gate tests use the module-singleton signInDraft so the
// shouldPersistLibraryData() lookup reads the same instance the test
// just wrote to. (vi.resetModules would give last-session a fresh
// signInDraft instance, decoupling it from the test's writes.)
describe('last-session writeToStorage gate', () => {
  beforeEach(() => {
    signInDraft.set(null);
    clearLastSession();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('writes to localStorage in persist mode (default — no draft)', () => {
    setLastSession(SAMPLE);
    expect(localStorage.getItem('last-session:v1')).toContain('"handle":"h"');
    expect(get(lastSession)?.handle).toBe('h');
    // sessionStorage stays empty; persist-mode JWTs live in localStorage
    // so closing one tab doesn't sign the user out across other tabs.
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
  });

  it('writes to localStorage when the draft has saveInventory: true', () => {
    signInDraft.set(PERSIST_DRAFT);
    setLastSession(SAMPLE);
    expect(localStorage.getItem('last-session:v1')).toContain('"handle":"h"');
  });

  it('writes to sessionStorage in session-only mode and clears localStorage', () => {
    // Seed a stale localStorage entry to confirm the session-only write
    // also wipes it (mode flip from persist → session-only).
    localStorage.setItem('last-session:v1', JSON.stringify({ ...SAMPLE, handle: 'old' }));
    signInDraft.set(SESSION_ONLY_DRAFT);
    setLastSession(SAMPLE);
    // In-memory store has the value (running session is signed in).
    expect(get(lastSession)?.handle).toBe('h');
    // sessionStorage is the new home; localStorage was cleared.
    expect(sessionStorage.getItem('last-session:v1')).toContain('"handle":"h"');
    expect(localStorage.getItem('last-session:v1')).toBeNull();
  });

  it('persist-mode write clears any stale sessionStorage entry', () => {
    // Seed a stale session-only entry to confirm the persist write
    // also wipes it (mode flip from session-only → persist).
    sessionStorage.setItem('last-session:v1', JSON.stringify({ ...SAMPLE, handle: 'old' }));
    signInDraft.set(PERSIST_DRAFT);
    setLastSession(SAMPLE);
    expect(localStorage.getItem('last-session:v1')).toContain('"handle":"h"');
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
  });

  it('clearLastSession wipes BOTH stores regardless of mode', () => {
    setLastSession(SAMPLE);
    sessionStorage.setItem('last-session:v1', JSON.stringify(SAMPLE));
    expect(localStorage.getItem('last-session:v1')).not.toBeNull();
    expect(sessionStorage.getItem('last-session:v1')).not.toBeNull();
    clearLastSession();
    expect(localStorage.getItem('last-session:v1')).toBeNull();
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
    expect(get(lastSession)).toBeNull();
  });
});

// Module-reload tests cover the readFromStorage entry point. Each test
// resets modules and dynamically imports so the writable's initial
// value is recomputed against the current sessionStorage / localStorage
// state — the in-memory svelte store can't simulate cold load.
describe('last-session cold-load read', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.resetModules();
  });

  it('reads from sessionStorage when only session-only data exists', async () => {
    sessionStorage.setItem('last-session:v1', JSON.stringify(SAMPLE));
    // Heartbeat must be fresh so expireStaleSessionData doesn't wipe it.
    localStorage.setItem('session-heartbeat:v1', String(Date.now()));
    const mod = await import('./last-session');
    expect(get(mod.lastSession)?.handle).toBe('h');
    // No promotion: session-only data stays in sessionStorage.
    expect(sessionStorage.getItem('last-session:v1')).not.toBeNull();
    expect(localStorage.getItem('last-session:v1')).toBeNull();
  });

  it('reads from localStorage when only persist-mode data exists', async () => {
    localStorage.setItem('last-session:v1', JSON.stringify(SAMPLE));
    const mod = await import('./last-session');
    expect(get(mod.lastSession)?.handle).toBe('h');
  });

  it('prefers sessionStorage over localStorage if both are set', async () => {
    sessionStorage.setItem('last-session:v1', JSON.stringify({ ...SAMPLE, handle: 'session' }));
    localStorage.setItem('last-session:v1', JSON.stringify({ ...SAMPLE, handle: 'local' }));
    localStorage.setItem('session-heartbeat:v1', String(Date.now()));
    const mod = await import('./last-session');
    expect(get(mod.lastSession)?.handle).toBe('session');
  });

  it('drops a stale session-only entry via heartbeat expiry on cold load', async () => {
    sessionStorage.setItem('last-session:v1', JSON.stringify(SAMPLE));
    // Stale heartbeat — older than the threshold.
    localStorage.setItem(
      'session-heartbeat:v1',
      String(Date.now() - 5 * 60 * 1000),
    );
    const mod = await import('./last-session');
    expect(get(mod.lastSession)).toBeNull();
    // The expiry should also have wiped the storage entry.
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
  });
});
