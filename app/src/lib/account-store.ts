import { get, set, del } from 'idb-keyval';

const KEY = 'account:v1';

/** Persist the handle of the account that produced the current inventory. */
export async function saveAccount(handle: string): Promise<void> {
  await set(KEY, handle);
}

export async function loadAccount(): Promise<string | null> {
  const v = (await get(KEY)) as string | undefined;
  return v ?? null;
}

export async function clearAccount(): Promise<void> {
  await del(KEY);
}
