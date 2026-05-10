// "Save Library to this device" — flips a session-only sign-in into
// persist mode and flushes everything currently in memory to disk.
// Reachable from the persistence-mode banner (App.svelte) when the user
// changes their mind mid-session.

import { get } from 'svelte/store';
import { persistInMemoryToDisk } from './inventory-store';
import { persistInMemoryImageBlobs } from './image-store';
import { signInDraft } from './sign-in-draft';
import { lastSession, setLastSession } from './last-session';

export async function saveLibraryToDevice(): Promise<void> {
  // 1. Flip the draft so the persistence gate (shouldPersistLibraryData)
  //    returns true for the rest of this session and for the writes the
  //    flush helpers below will perform.
  const draft = get(signInDraft);
  if (draft && draft.saveInventory === false) {
    signInDraft.set({ ...draft, saveInventory: true });
  }
  // 2. Flush the in-memory inventory and image blobs.
  await persistInMemoryToDisk();
  await persistInMemoryImageBlobs();
  // 3. Re-write the current session to sessionStorage now that the
  //    persistence gate is open. Without this step, the JWT pair would
  //    stay in-memory only and a browser quit would still log the user
  //    out — the "Save Library" intent should also include keeping the
  //    session warm.
  const session = get(lastSession);
  if (session) setLastSession(session);
}
