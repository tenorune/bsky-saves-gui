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
import { clearSessionHeartbeat } from './session-heartbeat';
import { clearSessionOnlyMarker } from './persistence-mode';

export async function saveLibraryToDevice(): Promise<void> {
  // Flip the draft AND the session-only marker FIRST so every
  // subsequent write below (persistInMemoryToDisk's IDB write,
  // setLastSession's localStorage write) sees persist mode.
  // shouldPersistLibraryData consults the marker first, so without
  // clearing it here, setLastSession would still write to
  // sessionStorage and we'd leave a stale entry behind.
  const draft = get(signInDraft);
  if (draft && draft.saveInventory === false) {
    signInDraft.set({ ...draft, saveInventory: true });
  }
  clearSessionOnlyMarker();
  // Move sessionStorage inventory → IDB and the in-memory blob map → IDB.
  await persistInMemoryToDisk();
  await persistInMemoryImageBlobs();
  // Move the presence flag from sessionStorage → localStorage so the
  // navbar Library link survives browser quit.
  promoteToPersistedPresence();
  // Re-write the active session, which now goes to localStorage
  // (persist mode) and clears the session-only sessionStorage entry
  // as part of writeToStorage's invariant.
  const session = get(lastSession);
  if (session) setLastSession(session);
  // The heartbeat existed to expire session-only sessionStorage data;
  // we just promoted everything to disk-backed storage, so the
  // heartbeat is no longer relevant. Clear it so it doesn't sit in
  // localStorage forever.
  clearSessionHeartbeat();
}
