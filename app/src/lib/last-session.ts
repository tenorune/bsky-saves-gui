import { writable, type Readable } from 'svelte/store';

export interface LastSession {
  readonly pds: string;
  readonly accessJwt: string;
  readonly did: string;
  readonly handle: string;
}

const store = writable<LastSession | null>(null);
export const lastSession: Readable<LastSession | null> = { subscribe: store.subscribe };

export function setLastSession(session: LastSession | null): void {
  store.set(session);
}
