// "Save Library to this device" — flips a session-only sign-in into
// persist mode and moves everything stored under the session backings
// (sessionStorage for inventory; in-memory for image blobs) onto IDB.
// Reachable from the persistence-mode banner (App.svelte) when the user
// changes their mind mid-session.

import { get } from 'svelte/store';
import { persistInMemoryToDisk } from './inventory-store';
import { persistInMemoryImageBlobs } from './image-store';
import { promoteToPersistedPresence } from './inventory-presence';
import { signInDraft } from './sign-in-draft';

export async function saveLibraryToDevice(): Promise<void> {
  // Flip the draft FIRST so subsequent writes (and the in-flight
  // persistInMemoryToDisk call below) see persist mode.
  const draft = get(signInDraft);
  if (draft && draft.saveInventory === false) {
    signInDraft.set({ ...draft, saveInventory: true });
  }
  // Move sessionStorage inventory → IDB and the in-memory blob map → IDB.
  await persistInMemoryToDisk();
  await persistInMemoryImageBlobs();
  // Move the presence flag from sessionStorage → localStorage so the
  // navbar Library link survives browser quit.
  promoteToPersistedPresence();
  // lastSession was already in sessionStorage (we no longer gate that
  // write on persistence mode); JWTs are short-lived enough that we
  // don't need to re-key it to localStorage. Browser quit still loses
  // the active session — sign-in-with-saved-credentials remains the
  // way to re-enter quickly.
}
