import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
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

describe('threads-toggle-on triggers thread hydration', () => {
  beforeEach(async () => {
    await clear();
    _resetAssetTogglesForTests();
  });

  it('calls onThreadsToggleOn when threads flips off→on', async () => {
    const onThreadsToggleOn = vi.fn();
    await setAssetToggle('threads', false, { onThreadsToggleOn });
    expect(onThreadsToggleOn).not.toHaveBeenCalled();
    await setAssetToggle('threads', true, { onThreadsToggleOn });
    expect(onThreadsToggleOn).toHaveBeenCalled();
  });

  it('does not call onThreadsToggleOn when threads is set to its existing value', async () => {
    const onThreadsToggleOn = vi.fn();
    await setAssetToggle('threads', true, { onThreadsToggleOn });
    expect(onThreadsToggleOn).not.toHaveBeenCalled();
  });

  it('does not call onThreadsToggleOn for other keys', async () => {
    const onThreadsToggleOn = vi.fn();
    await setAssetToggle('images', false, { onThreadsToggleOn });
    await setAssetToggle('images', true, { onThreadsToggleOn });
    expect(onThreadsToggleOn).not.toHaveBeenCalled();
  });
});
