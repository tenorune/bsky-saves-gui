// "Save Library to this device" — flips a session-only sign-in into
// persist mode and moves everything stored under the session backings
// (sessionStorage for inventory; in-memory for image blobs and
// lastSession) onto IDB / sessionStorage. Reachable from the
// persistence-mode banner (App.svelte) when the user changes their mind
// mid-session.

import { get } from 'svelte/store';
import { persistInMemoryToDisk } from './inventory-store';
import { persistInMemoryImageBlobs } from './image-store';
import { promoteToPersistedPresence } from './inventory-presence';
import { signInDraft } from './sign-in-draft';
import { lastSession, setLastSession } from './last-session';

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
  // Re-write the active session to sessionStorage now that the gate is
  // open. In session-only mode, lastSession was kept in memory only;
  // promoting it here means the user doesn't get logged out on the
  // next page reload after they opted into persistence.
  const session = get(lastSession);
  if (session) setLastSession(session);
}
