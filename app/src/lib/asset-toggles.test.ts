import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  assetToggles,
  setAssetToggle,
  loadAssetToggles,
  clearAssetToggles,
  _resetAssetTogglesForTests,
  type AssetTogglesShape,
} from './asset-toggles';
import { clear, get as idbGet } from 'idb-keyval';

describe('assetToggles', () => {
  beforeEach(async () => {
    await clear();
    _resetAssetTogglesForTests();
  });

  it('defaults all three to off (first-time-use)', () => {
    const t = get(assetToggles);
    expect(t).toEqual<AssetTogglesShape>({ threads: false, images: false, articles: false });
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
    expect(get(assetToggles)).toEqual<AssetTogglesShape>({ threads: false, images: false, articles: false });
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
    // Defaults are off; set to false (existing value) — no fire.
    await setAssetToggle('threads', false, { onThreadsToggleOn });
    expect(onThreadsToggleOn).not.toHaveBeenCalled();
  });

  it('does not call onThreadsToggleOn for other keys', async () => {
    const onThreadsToggleOn = vi.fn();
    await setAssetToggle('images', false, { onThreadsToggleOn });
    await setAssetToggle('images', true, { onThreadsToggleOn });
    expect(onThreadsToggleOn).not.toHaveBeenCalled();
  });
});

describe('images-toggle-on triggers image hydration', () => {
  beforeEach(async () => {
    await clear();
    _resetAssetTogglesForTests();
  });

  it('calls onImagesToggleOn when images flips off→on', async () => {
    const onImagesToggleOn = vi.fn();
    await setAssetToggle('images', false, { onImagesToggleOn });
    expect(onImagesToggleOn).not.toHaveBeenCalled();
    await setAssetToggle('images', true, { onImagesToggleOn });
    expect(onImagesToggleOn).toHaveBeenCalled();
  });

  it('does not call onImagesToggleOn for other keys', async () => {
    const onImagesToggleOn = vi.fn();
    await setAssetToggle('threads', false, { onImagesToggleOn });
    await setAssetToggle('threads', true, { onImagesToggleOn });
    expect(onImagesToggleOn).not.toHaveBeenCalled();
  });

  it('clearAssetToggles resets in-memory store to defaults and removes the IDB entry', async () => {
    await setAssetToggle('threads', true);
    await setAssetToggle('images', true);
    await setAssetToggle('articles', true);
    expect(get(assetToggles)).toEqual({ threads: true, images: true, articles: true });
    expect(await idbGet('asset-toggles:v1')).toBeDefined();

    await clearAssetToggles();

    expect(get(assetToggles)).toEqual({ threads: false, images: false, articles: false });
    expect(await idbGet('asset-toggles:v1')).toBeUndefined();
  });
});

describe('articles-toggle-on triggers article hydration', () => {
  beforeEach(async () => {
    await clear();
    _resetAssetTogglesForTests();
  });

  it('calls onArticlesToggleOn when articles flips off→on', async () => {
    const onArticlesToggleOn = vi.fn();
    await setAssetToggle('articles', false, { onArticlesToggleOn });
    expect(onArticlesToggleOn).not.toHaveBeenCalled();
    await setAssetToggle('articles', true, { onArticlesToggleOn });
    expect(onArticlesToggleOn).toHaveBeenCalled();
  });

  it('does not call onArticlesToggleOn for other keys', async () => {
    const onArticlesToggleOn = vi.fn();
    await setAssetToggle('images', false, { onArticlesToggleOn });
    await setAssetToggle('images', true, { onArticlesToggleOn });
    expect(onArticlesToggleOn).not.toHaveBeenCalled();
  });
});
