// Persist the handle of the account that produced the current inventory.
// Two backings depending on persistence mode:
//   - Persist mode: IDB. Survives across tabs, refresh, browser quit.
//   - Session-only mode: sessionStorage. Survives in-tab refresh, drops
//     on tab close, heartbeat-expired on stale-session reopen. Without
//     this gate, signing in unchecked would still leak the user's handle
//     to disk against the "don't keep my data on this device" intent.

import { get, set, del } from 'idb-keyval';
import { shouldPersistLibraryData } from './persistence-mode';
import { expireStaleSessionData } from './session-heartbeat';

const KEY = 'account:v1';

export async function saveAccount(handle: string): Promise<void> {
  if (shouldPersistLibraryData()) {
    // Persist mode → IDB. Also clear sessionStorage so a stale
    // session-only entry from a previous mode doesn't outlive the flip.
    if (typeof sessionStorage !== 'undefined') {
      try { sessionStorage.removeItem(KEY); } catch { /* best-effort */ }
    }
    await set(KEY, handle);
    return;
  }
  // Session-only → sessionStorage. Also clear IDB so a stale
  // persist-mode entry doesn't survive into the session-only session.
  await del(KEY);
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem(KEY, handle); } catch { /* quota — best-effort */ }
}

export async function loadAccount(): Promise<string | null> {
  // Run the expiry first so a stale heartbeat clears the
  // sessionStorage entry before we fall through to IDB.
  expireStaleSessionData();
  if (typeof sessionStorage !== 'undefined') {
    try {
      const fromSession = sessionStorage.getItem(KEY);
      if (fromSession) return fromSession;
    } catch { /* fall through */ }
  }
  const v = (await get(KEY)) as string | undefined;
  return v ?? null;
}

export async function clearAccount(): Promise<void> {
  if (typeof sessionStorage !== 'undefined') {
    try { sessionStorage.removeItem(KEY); } catch { /* best-effort */ }
  }
  await del(KEY);
}
