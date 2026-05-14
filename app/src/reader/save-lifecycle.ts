import type { Save } from './inventory-shape';

// v0.6.0 retain-flag: a save's visible lifecycle markers. A save can carry
// more than one — e.g. the user un-saved a post that the poster had also
// deleted — so this is a list, rendered as side-by-side badges.
export type LifecycleBadge = 'deleted' | 'blocked' | 'unsaved';

export function lifecycleBadges(save: Save): LifecycleBadge[] {
  const badges: LifecycleBadge[] = [];
  if (save.subject_status === 'not_found') badges.push('deleted');
  if (save.subject_status === 'blocked') badges.push('blocked');
  if (save.removed_detected_at) badges.push('unsaved');
  return badges;
}

export function lifecycleBadgeLabel(badge: LifecycleBadge): string {
  switch (badge) {
    case 'deleted':
      return 'Deleted';
    case 'blocked':
      return 'Blocked';
    case 'unsaved':
      return 'Unsaved';
  }
}
