import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  pairingToken,
  isValidTokenShape,
  initPairingToken,
  setPairingToken,
  clearPairingToken,
  markPairingStale,
  _resetPairingTokenForTests,
} from './pairing-token';

const STORAGE_KEY = 'bsky-saves-pairing-token:v1';
const META_NAME = 'bsky-saves-token';
const SENTINEL = '__BSKY_SAVES_TOKEN__';
const VALID_TOKEN_22 = 'a'.repeat(22);
const VALID_TOKEN_43 = 'x'.repeat(43);

function setMeta(content: string | null): void {
  const existing = document.querySelector(`meta[name="${META_NAME}"]`);
  if (existing) existing.remove();
  if (content !== null) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', META_NAME);
    meta.setAttribute('content', content);
    document.head.appendChild(meta);
  }
}

describe('isValidTokenShape', () => {
  it('accepts a 22-char base64url string', () => {
    expect(isValidTokenShape(VALID_TOKEN_22)).toBe(true);
  });

  it('accepts a 43-char base64url string', () => {
    expect(isValidTokenShape(VALID_TOKEN_43)).toBe(true);
  });

  it('accepts base64url-safe characters: A-Z, a-z, 0-9, dash, underscore', () => {
    expect(isValidTokenShape('aZ09_-aZ09_-aZ09_-aZ09')).toBe(true);
  });

  it('rejects the unsubstituted sentinel', () => {
    expect(isValidTokenShape(SENTINEL)).toBe(false);
  });

  it('rejects strings shorter than 22 chars', () => {
    expect(isValidTokenShape('a'.repeat(21))).toBe(false);
  });

  it('rejects strings longer than 64 chars', () => {
    expect(isValidTokenShape('a'.repeat(65))).toBe(false);
  });

  it('rejects strings with non-base64url characters', () => {
    expect(isValidTokenShape('a'.repeat(21) + '!')).toBe(false);
    expect(isValidTokenShape('a'.repeat(21) + '/')).toBe(false); // standard base64, not base64url
    expect(isValidTokenShape('a'.repeat(21) + '+')).toBe(false);
    expect(isValidTokenShape('a'.repeat(21) + '=')).toBe(false); // padding, base64url omits
  });

  it('rejects non-string inputs', () => {
    expect(isValidTokenShape(null)).toBe(false);
    expect(isValidTokenShape(undefined)).toBe(false);
    expect(isValidTokenShape(42)).toBe(false);
    expect(isValidTokenShape({})).toBe(false);
  });
});

describe('pairingToken store', () => {
  beforeEach(() => {
    _resetPairingTokenForTests();
    setMeta(null);
    localStorage.clear();
  });

  it('defaults to unpaired with no token', () => {
    expect(get(pairingToken)).toEqual({ state: 'unpaired', token: null });
  });

  describe('initPairingToken', () => {
    it('reads a valid token from the meta tag', () => {
      setMeta(VALID_TOKEN_22);
      initPairingToken();
      expect(get(pairingToken)).toEqual({ state: 'paired', token: VALID_TOKEN_22 });
    });

    it('ignores the unsubstituted sentinel in the meta tag', () => {
      setMeta(SENTINEL);
      initPairingToken();
      expect(get(pairingToken)).toEqual({ state: 'unpaired', token: null });
    });

    it('falls back to localStorage when the meta tag is the sentinel', () => {
      setMeta(SENTINEL);
      localStorage.setItem(STORAGE_KEY, VALID_TOKEN_43);
      initPairingToken();
      expect(get(pairingToken)).toEqual({ state: 'paired', token: VALID_TOKEN_43 });
    });

    it('falls back to localStorage when the meta tag is missing', () => {
      localStorage.setItem(STORAGE_KEY, VALID_TOKEN_43);
      initPairingToken();
      expect(get(pairingToken)).toEqual({ state: 'paired', token: VALID_TOKEN_43 });
    });

    it('meta tag wins over localStorage when both are valid', () => {
      setMeta(VALID_TOKEN_22);
      localStorage.setItem(STORAGE_KEY, VALID_TOKEN_43);
      initPairingToken();
      expect(get(pairingToken)).toEqual({ state: 'paired', token: VALID_TOKEN_22 });
    });

    it('leaves state at unpaired when neither path yields a valid token', () => {
      localStorage.setItem(STORAGE_KEY, 'not-a-token');
      initPairingToken();
      expect(get(pairingToken)).toEqual({ state: 'unpaired', token: null });
    });
  });

  describe('setPairingToken', () => {
    it('persists the token to localStorage and flips state to paired', () => {
      setPairingToken(VALID_TOKEN_22);
      expect(get(pairingToken)).toEqual({ state: 'paired', token: VALID_TOKEN_22 });
      expect(localStorage.getItem(STORAGE_KEY)).toBe(VALID_TOKEN_22);
    });

    it('replaces a previous token', () => {
      setPairingToken(VALID_TOKEN_22);
      setPairingToken(VALID_TOKEN_43);
      expect(get(pairingToken).token).toBe(VALID_TOKEN_43);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(VALID_TOKEN_43);
    });

    it('rejects an invalid token shape', () => {
      expect(() => setPairingToken('short')).toThrow();
      expect(() => setPairingToken(SENTINEL)).toThrow();
    });
  });

  describe('clearPairingToken', () => {
    it('removes the token and flips state to unpaired', () => {
      setPairingToken(VALID_TOKEN_22);
      clearPairingToken();
      expect(get(pairingToken)).toEqual({ state: 'unpaired', token: null });
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('is a no-op when no token is stored', () => {
      clearPairingToken();
      expect(get(pairingToken)).toEqual({ state: 'unpaired', token: null });
    });
  });

  describe('markPairingStale', () => {
    it('transitions paired → stale and keeps the token', () => {
      setPairingToken(VALID_TOKEN_22);
      markPairingStale();
      const s = get(pairingToken);
      expect(s.state).toBe('stale');
      expect(s.token).toBe(VALID_TOKEN_22);
    });

    it('is a no-op from unpaired (no token, no transition)', () => {
      markPairingStale();
      expect(get(pairingToken)).toEqual({ state: 'unpaired', token: null });
    });

    it('is idempotent from stale (stays stale, token preserved)', () => {
      setPairingToken(VALID_TOKEN_22);
      markPairingStale();
      markPairingStale();
      const s = get(pairingToken);
      expect(s.state).toBe('stale');
      expect(s.token).toBe(VALID_TOKEN_22);
    });
  });
});
