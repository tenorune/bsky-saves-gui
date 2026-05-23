import { describe, expect, it } from 'vitest';
import { buildStatusPayload, type StatusSnapshotInputs } from './status-payload';
import type { LastActivity } from './status-payload';

const IDLE_HYDRATION = { status: 'idle' as const, total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] };

const IDLE_ACTIVITY: LastActivity = {
  kind: 'idle',
  started_at: null,
  finished_at: null,
  added: 0,
  removed: 0,
  errors: [],
};

const BASE_INPUTS: StatusSnapshotInputs = {
  inventoryState: { status: 'ready', inventory: { saves: [] } as never },
  libraryRefreshState: { status: 'idle' },
  fetchProgress: IDLE_HYDRATION,
  imageHydration: IDLE_HYDRATION,
  articleHydration: IDLE_HYDRATION,
  threadProgress: IDLE_HYDRATION,
  persistenceMode: 'persist',
  lastSession: { pds: 'https://bsky.social', accessJwt: 'a', refreshJwt: 'r', did: 'did:plc:alice', handle: 'alice.bsky.social' },
  browserBytesEstimate: null,
  lastActivity: IDLE_ACTIVITY,
};

describe('buildStatusPayload', () => {
  it('returns null when lastSession is null', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, lastSession: null });
    expect(payload).toBeNull();
  });

  it('populates library.handle, library.did, library.total_saves from inputs', () => {
    const inv = {
      saves: [
        { uri: 'at://1' }, { uri: 'at://2' }, { uri: 'at://3' },
      ] as never,
    };
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'ready', inventory: inv },
    });
    expect(payload).not.toBeNull();
    expect(payload!.library!.handle).toBe('alice.bsky.social');
    expect(payload!.library!.did).toBe('did:plc:alice');
    expect(payload!.library!.total_saves).toBe(3);
  });

  // Coord-doc Q13: helper rejects `library.total_saves: null` with 400,
  // and §4.4 explicitly says the library block is "always present once
  // signed in AND has a non-empty inventory" — i.e. it's permitted to
  // be absent before that. Build accordingly so the panel falls into
  // its "Fetching library…" placeholder branch instead of misrendering
  // a fake "0 saves".
  it('omits the library block entirely when inventoryState is loading', () => {
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'loading' },
    });
    expect(payload).not.toBeNull();
    expect(payload!.library).toBeUndefined();
  });

  it('omits the library block entirely when inventoryState is empty', () => {
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'empty' },
    });
    expect(payload!.library).toBeUndefined();
  });

  it('omits the library block entirely when inventoryState has errored', () => {
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'error', message: 'parse failed' },
    });
    expect(payload!.library).toBeUndefined();
  });

  it('includes the library block with total_saves: 0 when inventory is ready and empty', () => {
    // Legitimately-empty user (signed in, fetch completed, zero saves) —
    // contrast with cold-start where inventory is loading/empty and the
    // library block is omitted. Once `ready`, we have a real count even
    // if that count is zero.
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'ready', inventory: { saves: [] } as never },
    });
    expect(payload!.library).not.toBeUndefined();
    expect(payload!.library!.total_saves).toBe(0);
    expect(payload!.library!.handle).toBe('alice.bsky.social');
    expect(payload!.library!.did).toBe('did:plc:alice');
  });

  it('counts by_status by retain-mode predicates', () => {
    const inv = {
      saves: [
        { uri: 'at://1' },                                  // synced
        { uri: 'at://2', subject_status: 'not_found' },     // lost
        { uri: 'at://3', subject_status: 'blocked' },       // lost
        { uri: 'at://4', removed_detected_at: '2026-05-10T00:00:00Z' }, // unsaved
        { uri: 'at://5', subject_status: 'unknown' },       // neither
      ] as never,
    };
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'ready', inventory: inv },
    });
    expect(payload!.library!.by_status).toEqual({
      synced: 1,
      lost: 2,
      unsaved: 1,
    });
  });

  it('populates hydration.{articles,threads,images} when their stores have a total', () => {
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      imageHydration: { ...IDLE_HYDRATION, total: 100, fetched: 30, skipped: 40 },
      articleHydration: { ...IDLE_HYDRATION, total: 50, fetched: 10, skipped: 5 },
      threadProgress: { ...IDLE_HYDRATION, total: 200, fetched: 100, skipped: 50 },
    });
    expect(payload!.hydration).toEqual({
      images: { completed: 70, total: 100 },
      articles: { completed: 15, total: 50 },
      threads: { completed: 150, total: 200 },
    });
  });

  it('omits a hydration bucket when its total is zero', () => {
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      imageHydration: { ...IDLE_HYDRATION, total: 100, fetched: 30, skipped: 40 },
      // articleHydration and threadProgress stay IDLE (total: 0)
    });
    expect(payload!.hydration).toEqual({
      images: { completed: 70, total: 100 },
    });
    expect(payload!.hydration.articles).toBeUndefined();
    expect(payload!.hydration.threads).toBeUndefined();
  });

  it('storage.mode is "persist" with null TTL in persist mode', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, persistenceMode: 'persist' });
    expect(payload!.storage.mode).toBe('persist');
    expect(payload!.storage.session_ttl_seconds).toBeNull();
  });

  it('storage.mode is "session" with 60s TTL when persistenceMode is session-only', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, persistenceMode: 'session-only' });
    expect(payload!.storage.mode).toBe('session');
    expect(payload!.storage.session_ttl_seconds).toBe(60);
  });

  it('storage.browser_bytes_estimate passes through from inputs', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, browserBytesEstimate: 18234567 });
    expect(payload!.storage.browser_bytes_estimate).toBe(18234567);
  });

  it('passes last_activity through from inputs verbatim', () => {
    const activity: LastActivity = {
      kind: 'fetch',
      started_at: '2026-05-21T20:13:11Z',
      finished_at: '2026-05-21T20:15:00Z',
      added: 3,
      removed: 1,
      errors: [{ kind: 'pds_timeout', message: 'PDS took too long', count: 1 }],
    };
    const payload = buildStatusPayload({ ...BASE_INPUTS, lastActivity: activity });
    expect(payload!.last_activity).toEqual(activity);
  });

  describe('current_state', () => {
    it('is "idle" when libraryRefreshState is idle', () => {
      const payload = buildStatusPayload(BASE_INPUTS);
      expect(payload!.current_state).toBe('idle');
    });

    it('is "refreshing" when libraryRefresh is running and fetch is in flight', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'running' },
        fetchProgress: { ...IDLE_HYDRATION, status: 'running', total: 100, fetched: 30 },
      });
      expect(payload!.current_state).toBe('refreshing');
    });

    it('is "hydrating" when libraryRefresh is running and fetch is done', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'running' },
        fetchProgress: { ...IDLE_HYDRATION, status: 'done', total: 100, fetched: 100 },
      });
      expect(payload!.current_state).toBe('hydrating');
    });

    it('is "error" when libraryRefreshState.status === "error"', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'error', error: 'something broke' },
      });
      expect(payload!.current_state).toBe('error');
    });

    // Issue #85 / coordination-doc Q10: library-refresh.ts kicks off
    // image and article hydration AFTER setting libraryRefreshState back
    // to idle. Before the fix, current_state would drop to 'idle' the
    // moment refresh ended, even though hydration ran for minutes after.
    it('is "hydrating" when imageHydration is running and refresh is idle', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'idle' },
        imageHydration: { ...IDLE_HYDRATION, status: 'running', total: 50 },
      });
      expect(payload!.current_state).toBe('hydrating');
    });

    it('is "hydrating" when articleHydration is running and refresh is idle', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'idle' },
        articleHydration: { ...IDLE_HYDRATION, status: 'running', total: 20 },
      });
      expect(payload!.current_state).toBe('hydrating');
    });

    it('is "hydrating" when threadProgress is running and refresh is idle', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'idle' },
        threadProgress: { ...IDLE_HYDRATION, status: 'running', total: 10 },
      });
      expect(payload!.current_state).toBe('hydrating');
    });

    it('prefers "error" over running hydration when refresh has errored', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'error', error: 'boom' },
        imageHydration: { ...IDLE_HYDRATION, status: 'running', total: 5 },
      });
      expect(payload!.current_state).toBe('error');
    });

    it('prefers "refreshing" over running hydration when refresh is running and fetch is in flight', () => {
      const payload = buildStatusPayload({
        ...BASE_INPUTS,
        libraryRefreshState: { status: 'running' },
        fetchProgress: { ...IDLE_HYDRATION, status: 'running', total: 100, fetched: 30 },
        imageHydration: { ...IDLE_HYDRATION, status: 'running', total: 50 },
      });
      expect(payload!.current_state).toBe('refreshing');
    });
  });

  it('omits the priority field when inputs.priority is absent', () => {
    const payload = buildStatusPayload(BASE_INPUTS);
    expect('priority' in payload!).toBe(false);
  });

  it('sets priority: "final" when inputs.priority is "final"', () => {
    const payload = buildStatusPayload({ ...BASE_INPUTS, priority: 'final' });
    expect(payload!.priority).toBe('final');
  });
});
