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
  fetch: true,
  threads: false,
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

  it('SKIPS disk in session-only mode but updates the in-memory store', () => {
    signInDraft.set(SESSION_ONLY_DRAFT);
    setLastSession(SAMPLE);
    // In-memory store has the value (so the running session is signed in)…
    expect(get(lastSession)?.handle).toBe('h');
    // …but neither store is touched, so closing the tab or quitting
    // the browser truly drops the JWTs.
    expect(localStorage.getItem('last-session:v1')).toBeNull();
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
  });

  it('clearLastSession wipes BOTH stores regardless of mode', () => {
    // Seed both stores to simulate a partial migration state.
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

// Migration tests need a fresh module load to re-run the readFromStorage
// path, so they reset modules and dynamically import.
describe('last-session migration', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.resetModules();
  });

  it('promotes a sessionStorage value to localStorage on first load', async () => {
    sessionStorage.setItem('last-session:v1', JSON.stringify(SAMPLE));
    const mod = await import('./last-session');
    // The module-level read should have promoted it.
    expect(get(mod.lastSession)?.handle).toBe('h');
    expect(localStorage.getItem('last-session:v1')).toContain('"handle":"h"');
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
  });

  it('prefers localStorage when both are populated', async () => {
    localStorage.setItem(
      'last-session:v1',
      JSON.stringify({ ...SAMPLE, handle: 'newer' }),
    );
    sessionStorage.setItem(
      'last-session:v1',
      JSON.stringify({ ...SAMPLE, handle: 'older' }),
    );
    const mod = await import('./last-session');
    expect(get(mod.lastSession)?.handle).toBe('newer');
  });
});
