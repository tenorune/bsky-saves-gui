import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  assetToggles,
  setAssetToggle,
  loadAssetToggles,
  _resetAssetTogglesForTests,
  type AssetTogglesShape,
} from './asset-toggles';
import { clear } from 'idb-keyval';

describe('assetToggles', () => {
  beforeEach(async () => {
    await clear();
    _resetAssetTogglesForTests();
  });

  it('defaults all three to on', () => {
    const t = get(assetToggles);
    expect(t).toEqual<AssetTogglesShape>({ threads: true, images: true, articles: true });
  });

  it('setAssetToggle updates the store and persists', async () => {
    await setAssetToggle('threads', false);
    expect(get(assetToggles).threads).toBe(false);
    _resetAssetTogglesForTests();
    await loadAssetToggles();
    expect(get(assetToggles).threads).toBe(false);
  });

  it('loadAssetToggles tolerates a missing record by keeping defaults', async () => {
    await loadAssetToggles();
    expect(get(assetToggles)).toEqual<AssetTogglesShape>({ threads: true, images: true, articles: true });
  });
});
