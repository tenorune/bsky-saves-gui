import { writable, type Readable } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';

export type AssetKey = 'threads' | 'images' | 'articles';

export interface AssetTogglesShape {
  readonly threads: boolean;
  readonly images: boolean;
  readonly articles: boolean;
}

const KEY = 'asset-toggles:v1';
// First-time-use default: all backups OFF. The user opts in per asset
// via the Settings checkboxes or the Library hub row badges.
const DEFAULTS: AssetTogglesShape = { threads: false, images: false, articles: false };

const store = writable<AssetTogglesShape>(DEFAULTS);
export const assetToggles: Readable<AssetTogglesShape> = { subscribe: store.subscribe };

export async function loadAssetToggles(): Promise<void> {
  const raw = (await idbGet(KEY)) as Partial<AssetTogglesShape> | undefined;
  if (!raw) return;
  store.set({
    threads: typeof raw.threads === 'boolean' ? raw.threads : DEFAULTS.threads,
    images: typeof raw.images === 'boolean' ? raw.images : DEFAULTS.images,
    articles: typeof raw.articles === 'boolean' ? raw.articles : DEFAULTS.articles,
  });
}

export interface SetAssetToggleDeps {
  readonly onThreadsToggleOn?: () => void;
  readonly onImagesToggleOn?: () => void;
  readonly onArticlesToggleOn?: () => void;
}

export async function setAssetToggle(
  key: AssetKey,
  value: boolean,
  deps: SetAssetToggleDeps = {},
): Promise<void> {
  let prev = false;
  store.subscribe((v) => { prev = v[key]; })();
  store.update((cur) => ({ ...cur, [key]: value }));
  let snapshot: AssetTogglesShape = DEFAULTS;
  store.subscribe((v) => { snapshot = v; })();
  await idbSet(KEY, snapshot);
  if (value && !prev) {
    if (key === 'threads') deps.onThreadsToggleOn?.();
    if (key === 'images') deps.onImagesToggleOn?.();
    if (key === 'articles') deps.onArticlesToggleOn?.();
  }
}

/** For tests only — resets to defaults without touching IndexedDB. */
export function _resetAssetTogglesForTests(): void {
  store.set(DEFAULTS);
}
