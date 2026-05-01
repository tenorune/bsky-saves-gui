// app/src/lib/credentials-store.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('credentialsStore', () => {
  beforeEach(async () => {
    const { clearCredentials } = await import('./credentials-store');
    await clearCredentials();
  });

  it('returns null when nothing is stored', async () => {
    const { loadCredentials } = await import('./credentials-store');
    expect(await loadCredentials('any-pass')).toBeNull();
  });

  it('round-trips credentials with the same passphrase', async () => {
    const { saveCredentials, loadCredentials } = await import('./credentials-store');
    await saveCredentials(
      { handle: 'alice.bsky.social', appPassword: 'pwd-1234', pds: 'https://bsky.social' },
      'right',
    );
    const got = await loadCredentials('right');
    expect(got).toEqual({
      handle: 'alice.bsky.social',
      appPassword: 'pwd-1234',
      pds: 'https://bsky.social',
    });
  });

  it('throws DecryptError on wrong passphrase', async () => {
    const { saveCredentials, loadCredentials } = await import('./credentials-store');
    const { DecryptError } = await import('./crypto');
    await saveCredentials({ handle: 'a', appPassword: 'b', pds: 'https://x' }, 'right');
    await expect(loadCredentials('wrong')).rejects.toBeInstanceOf(DecryptError);
  });

  it('hasCredentials returns true after save and false after clear', async () => {
    const { saveCredentials, hasCredentials, clearCredentials } = await import(
      './credentials-store'
    );
    expect(await hasCredentials()).toBe(false);
    await saveCredentials({ handle: 'a', appPassword: 'b', pds: 'https://x' }, 'p');
    expect(await hasCredentials()).toBe(true);
    await clearCredentials();
    expect(await hasCredentials()).toBe(false);
  });
});
