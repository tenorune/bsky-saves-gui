import { writable } from 'svelte/store';

export interface SignInDraft {
  handle: string;
  appPassword: string;
  pds: string;
  saveInventory: boolean;
  saveCredentials: boolean;
  passphrase: string;
}

export const signInDraft = writable<SignInDraft | null>(null);
