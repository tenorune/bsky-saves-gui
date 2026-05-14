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

  // When we have a preauthSession (from SignIn's main-thread createSession or
  // from a session-restore), use the JWT-pair credential shape so the helper
  // skips its per-request createSession against the user's PDS. Without this,
  // each /fetch page (and /hydrate-threads call) would do another createSession
  // — some PDSes rate-limit aggressively (eurosky.social returns 429 after a
  // few). The helper's v0.4.1 jwt-credentials path validates once and reuses
  // the JWTs across the whole pipeline.
  const pdsFromCreds = 'pds' in input.credentials && input.credentials.pds
    ? input.credentials.pds
    : undefined;
  const credentials: FetchSavesCredentials = input.preauthSession
    ? {
        accessJwt: input.preauthSession.accessJwt,
        refreshJwt: input.preauthSession.refreshJwt,
        did: input.preauthSession.did,
        ...(pdsFromCreds ? { pds: pdsFromCreds } : {}),
      }
    : input.credentials;

  // ALL-OR-NOTHING PAGINATION (preserve across refactors).
  // This loop accumulates pages until the cursor is null and only then
  // returns. Any failure mid-pagination throws — the partially-accumulated
  // `saves` array is discarded with the stack frame, never returned. That
  // is load-bearing: the library-refresh reconcile (and the v0.6.0
  // retain-flag reconcile that extends it — see
  // docs/v0.6.0-retain-flag-gui-implementation-plan.md) treats its input
  // as a COMPLETE fetch and does absence-detection against it. A
  // partial-page set leaking out of here would let live bookmarks be
  // flagged un-saved. If this ever grows incremental/streaming behaviour,
  // it must signal "completed" vs "partial" so the reconcile can refuse
  // to run on a partial set.
  const saves: unknown[] = [];
  let cursor: string | null = null;
  while (true) {
    const res = await fetchSaves(input.origin, { credentials, cursor, limit: 100 });
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

  // Pyodide path needs handle + pds + appPassword for env vars, but the
  // worker's create_session monkey-patch (applyPreauthSessionPatch) bypasses
  // the actual createSession call when preauthSession is provided. So with
  // a preauthSession in hand, JWT-pair credentials work — appPassword can be
  // empty since it's never read.
  const isAppPw = 'appPassword' in input.credentials;
  if (!isAppPw && !input.preauthSession) {
    throw new Error('Pyodide path requires app-password credentials');
  }
  const handle = isAppPw
    ? input.credentials.handle
    : (input.preauthSession?.handle ?? '');
  const appPassword = isAppPw ? input.credentials.appPassword : '';
  const pds = ('pds' in input.credentials && input.credentials.pds) || 'https://bsky.social';

  const inv = await driver.runFetchOnly({
    handle,
    appPassword,
    pds,
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
