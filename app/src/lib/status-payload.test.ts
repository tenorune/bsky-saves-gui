import { describe, expect, it } from 'vitest';
import { buildStatusPayload, type StatusSnapshotInputs } from './status-payload';

const IDLE_HYDRATION = { status: 'idle' as const, total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] };

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
    expect(payload!.library.handle).toBe('alice.bsky.social');
    expect(payload!.library.did).toBe('did:plc:alice');
    expect(payload!.library.total_saves).toBe(3);
  });

  it('library.total_saves is null when inventoryState is not ready', () => {
    const payload = buildStatusPayload({
      ...BASE_INPUTS,
      inventoryState: { status: 'loading' },
    });
    expect(payload!.library.total_saves).toBeNull();
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
    expect(payload!.library.by_status).toEqual({
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
});
