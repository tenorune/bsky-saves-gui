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

// A "dead subject" save — the underlying post was deleted (not_found) or
// blocked by its poster. There's no live post to fetch a thread, images, or
// a linked article for, so the hydrators skip these. (An `unknown` status is
// NOT dead: it just means a content-blind fetch couldn't tell.)
export function isDeadSubject(save: { readonly subject_status?: unknown }): boolean {
  return save.subject_status === 'not_found' || save.subject_status === 'blocked';
}

/**
 * Return a shallow copy of `inventory` with dead-subject saves removed, for
 * feeding the asset hydrators (images / articles) — they shouldn't try to
 * fetch assets for a deleted or blocked post. A value that isn't an inventory
 * object (or whose `saves` isn't an array) is passed through unchanged.
 *
 * NOTE: this is for *deriving the work set* only. Don't persist the result —
 * it would drop the dead-subject entries the retain mode chose to keep.
 */
export function excludeDeadSubjectSaves(inventory: unknown): unknown {
  if (!inventory || typeof inventory !== 'object') return inventory;
  const inv = inventory as { saves?: unknown };
  if (!Array.isArray(inv.saves)) return inventory;
  return {
    ...inv,
    saves: inv.saves.filter(
      (s) => !(s && typeof s === 'object' && isDeadSubject(s as { subject_status?: unknown })),
    ),
  };
}
