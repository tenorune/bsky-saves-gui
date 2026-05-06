import { get, set, del } from 'idb-keyval';
import type { HydrationFailure } from './hydration-state';

const KEYS = {
  images: 'failures:images:v1',
  articles: 'failures:articles:v1',
} as const;

type Domain = 'images' | 'articles';

function isHydrationFailure(v: unknown): v is HydrationFailure {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.url === 'string' && typeof r.reason === 'string';
}

/**
 * Persist a domain's failure list to IDB. Failures aren't stored as part of
 * the inventory or the image-store, so without this they'd be lost on every
 * full page reload.
 */
export async function saveFailures(
  domain: Domain,
  failures: readonly HydrationFailure[],
): Promise<void> {
  if (failures.length === 0) {
    await del(KEYS[domain]);
    return;
  }
  // Defensive copy + plain shape so idb-keyval's structured-clone is happy.
  const out: HydrationFailure[] = failures.map((f) => ({ url: f.url, reason: f.reason }));
  await set(KEYS[domain], out);
}

/**
 * Load a domain's persisted failure list. Returns `[]` for missing or
 * malformed values; never throws.
 */
export async function loadFailures(domain: Domain): Promise<HydrationFailure[]> {
  try {
    const v = await get(KEYS[domain]);
    if (!Array.isArray(v)) return [];
    return v.filter(isHydrationFailure);
  } catch {
    return [];
  }
}

/**
 * Clear persisted failures. With no argument, clears both domains.
 */
export async function clearFailures(domain?: Domain): Promise<void> {
  if (domain === undefined) {
    await Promise.all([del(KEYS.images), del(KEYS.articles)]);
    return;
  }
  await del(KEYS[domain]);
}
