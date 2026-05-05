// Per-feature banner state. Records when the user last said "Remind me later"
// and whether they ticked "Don't ask me again". Used by the Library's
// just-in-time backup banners and mirrored as toggles in Settings.
//
// Concurrency note: snooze/dontAsk writes are read-modify-write without a
// lock. In a single tab this is fine — the UI mutates one field at a time.
// Across multiple open tabs, two near-simultaneous writes can clobber each
// other; the worst outcome is that one tab's "Remind me later" gets lost.
// Acceptable for banner state.

import { get, set, del } from 'idb-keyval';

export type BackupFeature = 'images' | 'articles';

export interface FeaturePrefs {
  readonly snoozeUntil: number | null; // epoch ms; null means never snoozed
  readonly dontAsk: boolean;
  readonly enabled: boolean;
}

export interface BackupPrefs {
  readonly images: FeaturePrefs;
  readonly articles: FeaturePrefs;
  readonly operatorProxyOptOut: boolean;
}

const KEY = 'backup-prefs:v1';
const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;

const DEFAULTS: BackupPrefs = Object.freeze({
  images: { snoozeUntil: null, dontAsk: false, enabled: false },
  articles: { snoozeUntil: null, dontAsk: false, enabled: false },
  operatorProxyOptOut: false,
});

function isFeaturePrefs(v: unknown): v is FeaturePrefs {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    (r.snoozeUntil === null || typeof r.snoozeUntil === 'number') &&
    typeof r.dontAsk === 'boolean' &&
    typeof r.enabled === 'boolean'
  );
}

function isBackupPrefs(v: unknown): v is BackupPrefs {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    isFeaturePrefs(r.images) &&
    isFeaturePrefs(r.articles) &&
    typeof r.operatorProxyOptOut === 'boolean'
  );
}

export async function loadBackupPrefs(): Promise<BackupPrefs> {
  const raw = await get(KEY);
  return isBackupPrefs(raw) ? raw : DEFAULTS;
}

async function saveBackupPrefs(p: BackupPrefs): Promise<void> {
  await set(KEY, p);
}

export async function snoozeBackupPrompt(feature: BackupFeature): Promise<void> {
  const prefs = await loadBackupPrefs();
  const next: BackupPrefs = {
    ...prefs,
    [feature]: { ...prefs[feature], snoozeUntil: Date.now() + SNOOZE_MS },
  };
  await saveBackupPrefs(next);
}

export async function setBackupDontAsk(
  feature: BackupFeature,
  dontAsk: boolean,
): Promise<void> {
  const prefs = await loadBackupPrefs();
  const next: BackupPrefs = {
    ...prefs,
    [feature]: { ...prefs[feature], dontAsk },
  };
  await saveBackupPrefs(next);
}

export async function setBackupEnabled(
  feature: BackupFeature,
  enabled: boolean,
): Promise<void> {
  const prefs = await loadBackupPrefs();
  const next: BackupPrefs = {
    ...prefs,
    [feature]: { ...prefs[feature], enabled },
  };
  await saveBackupPrefs(next);
}

export async function setOperatorProxyOptOut(optOut: boolean): Promise<void> {
  const prefs = await loadBackupPrefs();
  const next: BackupPrefs = { ...prefs, operatorProxyOptOut: optOut };
  await saveBackupPrefs(next);
}

export async function shouldShowBackupBanner(feature: BackupFeature): Promise<boolean> {
  const prefs = await loadBackupPrefs();
  const f = prefs[feature];
  if (f.dontAsk) return false;
  if (f.enabled) return false;
  if (f.snoozeUntil !== null && Date.now() < f.snoozeUntil) return false;
  return true;
}

export async function clearBackupPrefs(): Promise<void> {
  await del(KEY);
}
