// app/src/lib/crypto.test.ts
import { describe, expect, it } from 'vitest';

describe('crypto', () => {
  it('round-trips a plaintext through encrypt/decrypt with the same passphrase', async () => {
    const { encrypt, decrypt } = await import('./crypto');
    const ciphertext = await encrypt('hello world', 'correct horse battery staple');
    const plaintext = await decrypt(ciphertext, 'correct horse battery staple');
    expect(plaintext).toBe('hello world');
  });

  it('produces different ciphertext for the same plaintext+passphrase across calls', async () => {
    const { encrypt } = await import('./crypto');
    const a = await encrypt('hi', 'pass');
    const b = await encrypt('hi', 'pass');
    expect(a).not.toBe(b); // distinct salt + IV
  });

  it('throws on wrong passphrase', async () => {
    const { encrypt, decrypt, DecryptError } = await import('./crypto');
    const ciphertext = await encrypt('secret', 'right');
    await expect(decrypt(ciphertext, 'wrong')).rejects.toBeInstanceOf(DecryptError);
  });

  it('rejects malformed ciphertext', async () => {
    const { decrypt, DecryptError } = await import('./crypto');
    await expect(decrypt('not-base64-or-json', 'p')).rejects.toBeInstanceOf(DecryptError);
  });
});
