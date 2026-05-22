import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clear } from 'idb-keyval';
import {
  loadLastActivity,
  saveLastActivity,
  clearLastActivity,
} from './last-activity-persist';
import type { LastActivity } from './status-payload';

describe('last-activity-persist', () => {
  beforeEach(async () => {
    await clear();
  });
  afterEach(async () => {
    await clear();
  });

  it('loadLastActivity returns null when nothing was ever persisted', async () => {
    expect(await loadLastActivity()).toBeNull();
  });

  it('saveLastActivity → loadLastActivity round-trips a complete record', async () => {
    const activity: LastActivity = {
      kind: 'hydrate_images',
      started_at: '2026-05-22T01:00:00.000Z',
      finished_at: '2026-05-22T01:05:00.000Z',
      added: 12,
      removed: 0,
      errors: [{ kind: 'hydration_error', message: 'timeout', count: 1 }],
    };
    await saveLastActivity(activity);
    expect(await loadLastActivity()).toEqual(activity);
  });

  it('clearLastActivity wipes the persisted record', async () => {
    await saveLastActivity({
      kind: 'fetch',
      started_at: '2026-05-22T01:00:00Z',
      finished_at: null,
      added: 0,
      removed: 0,
      errors: [],
    });
    await clearLastActivity();
    expect(await loadLastActivity()).toBeNull();
  });

  it('loadLastActivity returns null when the persisted value is not a valid LastActivity shape', async () => {
    // Inject a garbage value bypassing saveLastActivity's typed signature.
    const { set } = await import('idb-keyval');
    await set('status-pusher:last-activity:v1', { not: 'a real record' });
    expect(await loadLastActivity()).toBeNull();
  });
});
