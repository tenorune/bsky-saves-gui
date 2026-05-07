import { get } from 'svelte/store';
import { fetchProgress, resetFetchProgress } from './hydration-state';
import {
  fetchSaves as defaultFetchSaves,
  type FetchSavesCredentials,
  type FetchSavesResponse,
} from './helper-client';
import { setLastSession as defaultSetLastSession, lastSession } from './last-session';
import { getSharedDriver } from './pyodide-worker-driver';
import type { PyodideWorkerDriver } from './pyodide-worker-driver';
import { config } from './config';
import type { PreauthSession } from './preauth-session';

export type FetchBackend = { kind: 'helper' } | { kind: 'pyodide' };

export interface FetchHydratorInput {
  readonly backend: FetchBackend;
  readonly origin: string;        // helper origin; ignored for pyodide
  readonly credentials: FetchSavesCredentials;
  readonly preauthSession?: PreauthSession;
}

export interface FetchHydratorDeps {
  readonly fetchSaves?: (origin: string, req: { credentials: FetchSavesCredentials; cursor: string | null; limit: number; }) => Promise<FetchSavesResponse>;
  readonly setLastSession?: typeof defaultSetLastSession;
  readonly driver?: PyodideWorkerDriver;
}

async function runHelperPath(
  input: FetchHydratorInput,
  deps: FetchHydratorDeps,
): Promise<{ saves: unknown[] }> {
  const fetchSaves = deps.fetchSaves ?? defaultFetchSaves;
  const setLastSession = deps.setLastSession ?? defaultSetLastSession;

  resetFetchProgress();
  fetchProgress.set({ status: 'running', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] });

  const saves: unknown[] = [];
  let cursor: string | null = null;
  while (true) {
    const res = await fetchSaves(input.origin, { credentials: input.credentials, cursor, limit: 100 });
    saves.push(...res.saves);
    fetchProgress.update((p) => ({ ...p, fetched: p.fetched + res.saves.length, total: p.fetched + res.saves.length }));
    if (res.rotated_credentials) {
      // Preserve handle + pds from the existing last-session (JWT credentials don't carry them).
      // Read existing BEFORE calling setLastSession so we don't read the value we just wrote.
      const existing = get(lastSession);
      setLastSession({
        pds:
          existing?.pds ??
          ('pds' in input.credentials && input.credentials.pds ? input.credentials.pds : 'https://bsky.social'),
        accessJwt: res.rotated_credentials.access_jwt,
        refreshJwt: res.rotated_credentials.refresh_jwt,
        did: res.rotated_credentials.did,
        handle: existing?.handle ?? ('handle' in input.credentials ? input.credentials.handle : ''),
      });
    }
    if (!res.cursor) break;
    cursor = res.cursor;
  }
  fetchProgress.update((p) => ({ ...p, status: 'done' }));
  return { saves };
}

async function runPyodidePath(
  input: FetchHydratorInput,
  deps: FetchHydratorDeps,
): Promise<unknown> {
  const driver = deps.driver ?? getSharedDriver();
  await driver.initialise(config.pyodideVersion);
  resetFetchProgress();
  fetchProgress.set({ status: 'running', total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] });
  if (!('appPassword' in input.credentials)) {
    throw new Error('Pyodide path requires app-password credentials');
  }
  const inv = await driver.runFetchOnly({
    handle: input.credentials.handle,
    appPassword: input.credentials.appPassword,
    pds: input.credentials.pds,
    preauthSession: input.preauthSession,
  });
  fetchProgress.update((p) => ({ ...p, status: 'done' }));
  return inv;
}

export const fetchHydrator = {
  async start(input: FetchHydratorInput, deps: FetchHydratorDeps = {}): Promise<unknown> {
    if (input.backend.kind === 'helper') {
      try { return await runHelperPath(input, deps); }
      catch (e) { fetchProgress.update((p) => ({ ...p, status: 'cancelled' })); throw e; }
    }
    try { return await runPyodidePath(input, deps); }
    catch (e) { fetchProgress.update((p) => ({ ...p, status: 'cancelled' })); throw e; }
  },
};
