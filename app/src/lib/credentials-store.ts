import { get, set, del } from 'idb-keyval';
import { encrypt, decrypt } from './crypto';

const KEY = 'credentials:v1';

export interface Credentials {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
}

export async function saveCredentials(creds: Credentials, passphrase: string): Promise<void> {
  const envelope = await encrypt(JSON.stringify(creds), passphrase);
  await set(KEY, envelope);
}

export async function loadCredentials(passphrase: string): Promise<Credentials | null> {
  const envelope = (await get(KEY)) as string | undefined;
  if (!envelope) return null;
  const json = await decrypt(envelope, passphrase);
  return JSON.parse(json) as Credentials;
}

export async function hasCredentials(): Promise<boolean> {
  const envelope = await get(KEY);
  return envelope !== undefined;
}

export async function clearCredentials(): Promise<void> {
  await del(KEY);
}
