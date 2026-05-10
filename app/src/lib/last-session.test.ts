import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { signInDraft } from './sign-in-draft';
import { lastSession, setLastSession, clearLastSession } from './last-session';

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

beforeEach(() => {
  signInDraft.set(null);
  sessionStorage.clear();
  clearLastSession();
});

describe('last-session writeToStorage gate', () => {
  it('writes to sessionStorage in persist mode (default — no draft)', () => {
    setLastSession(SAMPLE);
    expect(sessionStorage.getItem('last-session:v1')).toContain('"handle":"h"');
    expect(get(lastSession)?.handle).toBe('h');
  });

  it('writes to sessionStorage when the draft has saveInventory: true', () => {
    signInDraft.set(PERSIST_DRAFT);
    setLastSession(SAMPLE);
    expect(sessionStorage.getItem('last-session:v1')).toContain('"handle":"h"');
  });

  it('SKIPS sessionStorage in session-only mode but updates the in-memory store', () => {
    signInDraft.set(SESSION_ONLY_DRAFT);
    setLastSession(SAMPLE);
    // In-memory store has the value (so the running session is signed in)…
    expect(get(lastSession)?.handle).toBe('h');
    // …but sessionStorage is untouched, so a session-restoring browser
    // can't auto-resume the account on next launch.
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
  });

  it('clearLastSession always wipes sessionStorage regardless of mode', () => {
    // Seed via a persist write, then flip to session-only.
    setLastSession(SAMPLE);
    expect(sessionStorage.getItem('last-session:v1')).not.toBeNull();
    signInDraft.set(SESSION_ONLY_DRAFT);
    clearLastSession();
    expect(sessionStorage.getItem('last-session:v1')).toBeNull();
    expect(get(lastSession)).toBeNull();
  });
});
