import { describe, expect, it } from 'vitest';
import type { Save } from './inventory-shape';
import { lifecycleBadges, lifecycleBadgeLabel } from './save-lifecycle';

function base(): Save {
  return {
    uri: 'at://x/y/1',
    cid: 'c',
    author: { did: 'd', handle: 'h.example' },
    record: { text: 't', createdAt: '2026-04-01T00:00:00Z' },
    indexedAt: '2026-04-01T00:00:00Z',
  };
}

describe('lifecycleBadges', () => {
  it('returns no badges for a live, still-saved post', () => {
    expect(lifecycleBadges(base())).toEqual([]);
  });

  it("flags a not_found subject as 'deleted'", () => {
    expect(lifecycleBadges({ ...base(), subject_status: 'not_found' })).toEqual(['deleted']);
  });

  it("flags a blocked subject as 'blocked'", () => {
    expect(lifecycleBadges({ ...base(), subject_status: 'blocked' })).toEqual(['blocked']);
  });

  it("flags removed_detected_at as 'unsaved'", () => {
    expect(
      lifecycleBadges({ ...base(), removed_detected_at: '2026-04-10T00:00:00Z' }),
    ).toEqual(['unsaved']);
  });

  it('returns both badges when the user un-saved an already-deleted post', () => {
    expect(
      lifecycleBadges({
        ...base(),
        subject_status: 'not_found',
        removed_detected_at: '2026-04-10T00:00:00Z',
      }),
    ).toEqual(['deleted', 'unsaved']);
  });

  it("treats an 'unknown' subject_status as no badge", () => {
    expect(lifecycleBadges({ ...base(), subject_status: 'unknown' })).toEqual([]);
  });
});

describe('lifecycleBadgeLabel', () => {
  it('maps each badge to its display label', () => {
    expect(lifecycleBadgeLabel('deleted')).toBe('Deleted');
    expect(lifecycleBadgeLabel('blocked')).toBe('Blocked');
    expect(lifecycleBadgeLabel('unsaved')).toBe('Unsaved');
  });
});
