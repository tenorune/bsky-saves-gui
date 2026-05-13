import { writable } from 'svelte/store';

export interface SignInDraft {
  handle: string;
  appPassword: string;
  pds: string;
  saveInventory: boolean;
  saveCredentials: boolean;
  passphrase: string;
}

// USER-SPECIFIC. In-memory only (never written to storage). Holds the
// plaintext app password from the most recent sign-in form submission
// so asset hydrators can re-auth against the PDS without re-prompting
// the user. Cleared on every identity-change boundary:
//   - Settings → Clear data clears the draft via signInDraft.set(null)
//     (and clears credentials, last-session, etc.).
//   - Settings → Sign out sets the draft to null — critical because
//     without it, asset hydration could still authenticate against
//     the PDS using the residual password, making sign-out a no-op
//     for active backups (see Settings.svelte::signOut).
//   - SignIn.submit overwrites with the new account's credentials.
// See issue #19 for the singleton-audit catalogue.
export const signInDraft = writable<SignInDraft | null>(null);
