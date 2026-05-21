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
});
