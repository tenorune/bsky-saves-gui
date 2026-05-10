import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveAccount, loadAccount, clearAccount } from './account-store';

beforeEach(async () => {
  await clearAccount();
});

describe('account-store', () => {
  it('round-trips a handle', async () => {
    expect(await loadAccount()).toBeNull();
    await saveAccount('alice.bsky.social');
    expect(await loadAccount()).toBe('alice.bsky.social');
  });

  it('overwrites on subsequent saves (handle changes are rare but possible)', async () => {
    await saveAccount('alice.bsky.social');
    await saveAccount('alice-renamed.bsky.social');
    expect(await loadAccount()).toBe('alice-renamed.bsky.social');
  });

  it('clearAccount removes the stored handle', async () => {
    await saveAccount('alice.bsky.social');
    await clearAccount();
    expect(await loadAccount()).toBeNull();
  });
});
