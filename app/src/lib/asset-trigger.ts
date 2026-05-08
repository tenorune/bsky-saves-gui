// Shared "kick off a hydration over the existing inventory" helpers used by
// both Settings and the Library hub when the user toggles a backup on (or
// clicks a row badge in the Hub). Every flip-to-on for an asset triggers
// the matching hydrator to bring the inventory up to date.
//
// All three return immediately when there's no usable inventory or (for
// threads) no usable credentials. They never throw — the caller fires
// these and forgets.

import { get } from 'svelte/store';
import { loadInventory, saveInventory } from './inventory-store';
import { threadHydrator } from './thread-hydrator';
import { startImageBackup } from './start-image-backup';
import { startArticleBackup } from './start-article-backup';
import { capabilitySnapshot } from './capability-snapshot';
import { config } from './config';
import { lastSession } from './last-session';
import { signInDraft } from './sign-in-draft';

export async function triggerThreadHydration(): Promise<void> {
  const inv = (await loadInventory()) as { saves: { uri: string }[] } | null;
  if (!inv) return;
  const draft = get(signInDraft);
  const session = get(lastSession);
  const credentials = draft && draft.appPassword
    ? { handle: draft.handle, appPassword: draft.appPassword, pds: draft.pds }
    : session
      ? { accessJwt: session.accessJwt, refreshJwt: session.refreshJwt, did: session.did, pds: session.pds }
      : null;
  if (!credentials) return;
  const preauthSession = session
    ? {
        accessJwt: session.accessJwt,
        refreshJwt: session.refreshJwt,
        did: session.did,
        handle: session.handle,
      }
    : undefined;
  const out = await threadHydrator.start({
    backend: get(capabilitySnapshot).threads,
    origin: config.helperOrigin,
    inventory: inv,
    credentials,
    preauthSession,
  });
  await saveInventory(out);
}

export async function triggerImageHydration(): Promise<void> {
  const inv = await loadInventory();
  if (!inv) return;
  void startImageBackup(inv);
}

export async function triggerArticleHydration(): Promise<void> {
  const inv = await loadInventory();
  if (!inv) return;
  void startArticleBackup(inv);
}
