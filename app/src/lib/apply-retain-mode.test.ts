import { describe, expect, it } from 'vitest';
import { applyRetainMode } from './library-refresh';

const live = { uri: 'at://x/1', saved_at: '2026-04-10T00:00:00Z', post_text: 'live' };
const unsaved = {
  uri: 'at://x/2',
  saved_at: '2026-04-11T00:00:00Z',
  post_text: 'unsaved',
  removed_detected_at: '2026-05-10T00:00:00Z',
};
const deadSubject = {
  uri: 'at://x/3',
  saved_at: '2026-04-12T00:00:00Z',
  post_text: 'deleted',
  subject_status: 'not_found',
};
const blocked = {
  uri: 'at://x/4',
  saved_at: '2026-04-13T00:00:00Z',
  post_text: 'blocked',
  subject_status: 'blocked',
};

const inventory = {
  fetched_at: '2026-05-01T00:00:00Z',
  saves: [live, unsaved, deadSubject, blocked],
};

describe('applyRetainMode', () => {
  it('keep-all retains every entry', () => {
    const r = applyRetainMode(inventory, 'keep-all');
    expect(r.saves).toEqual([live, unsaved, deadSubject, blocked]);
    expect(r.fetched_at).toBe('2026-05-01T00:00:00Z');
  });

  it('keep-lost drops un-saved entries but keeps dead-subject ones', () => {
    const r = applyRetainMode(inventory, 'keep-lost');
    expect(r.saves).toEqual([live, deadSubject, blocked]);
  });

  it('sync drops both un-saved and dead-subject entries', () => {
    const r = applyRetainMode(inventory, 'sync');
    expect(r.saves).toEqual([live]);
  });

  it('carries fetched_at through unchanged and tolerates a missing saves array', () => {
    const r = applyRetainMode({ fetched_at: '2026-01-01T00:00:00Z' }, 'sync');
    expect(r).toEqual({ fetched_at: '2026-01-01T00:00:00Z', saves: [] });
  });
});
