const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export class DecryptError extends Error {
  constructor(message = 'Decryption failed') {
    super(message);
    this.name = 'DecryptError';
  }
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer instanceof ArrayBuffer
    ? (out as Uint8Array<ArrayBuffer>)
    : new Uint8Array(out);
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encrypt(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  return JSON.stringify({
    v: 1,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ciphertext),
  });
}

export async function decrypt(envelope: string, passphrase: string): Promise<string> {
  let parsed: { v: number; salt: string; iv: string; ct: string };
  try {
    parsed = JSON.parse(envelope);
    if (parsed.v !== 1 || !parsed.salt || !parsed.iv || !parsed.ct) {
      throw new Error('bad envelope');
    }
  } catch {
    throw new DecryptError('Malformed ciphertext');
  }
  try {
    const salt = fromB64(parsed.salt);
    const iv = fromB64(parsed.iv);
    const ct = fromB64(parsed.ct);
    const key = await deriveKey(passphrase, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    throw new DecryptError();
  }
}
