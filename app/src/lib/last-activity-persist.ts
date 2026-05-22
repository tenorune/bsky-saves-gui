// Persist the status pusher's `last_activity` record across GUI tab
// closes / app restarts. Without persistence, the in-memory module
// variable resets to `{ kind: 'idle', ... }` on every fresh load, and
// the activation-rising-edge "fresh-state" push clobbers the helper's
// on-disk snapshot with that idle default — losing the panel's history
// of the most recent real activity. See issue #85 (Bug 2) and
// bsky-saves-coordination:docs/installer-status-panel.md Q10.

import { get, set, del } from 'idb-keyval';
import type { LastActivity } from './status-payload';

const KEY = 'status-pusher:last-activity:v1';

export async function loadLastActivity(): Promise<LastActivity | null> {
  try {
    const raw = await get(KEY);
    return isLastActivity(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function saveLastActivity(activity: LastActivity): Promise<void> {
  try {
    await set(KEY, activity);
  } catch {
    /* best-effort */
  }
}

export async function clearLastActivity(): Promise<void> {
  try {
    await del(KEY);
  } catch {
    /* best-effort */
  }
}

function isLastActivity(value: unknown): value is LastActivity {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const kindOk = typeof v.kind === 'string';
  const startedAtOk = v.started_at === null || typeof v.started_at === 'string';
  const finishedAtOk = v.finished_at === null || typeof v.finished_at === 'string';
  const addedOk = typeof v.added === 'number';
  const removedOk = typeof v.removed === 'number';
  const errorsOk = Array.isArray(v.errors);
  return kindOk && startedAtOk && finishedAtOk && addedOk && removedOk && errorsOk;
}
