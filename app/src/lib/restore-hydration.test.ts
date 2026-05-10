import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { get } from 'svelte/store';

beforeEach(async () => {
  const { resetImageHydration, resetArticleHydration } = await import('./hydration-state');
  resetImageHydration();
  resetArticleHydration();
  const { clearImageBlobs, saveImageBlob } = await import('./image-store');
  await clearImageBlobs();
  // Pre-seed two saved blobs.
  await saveImageBlob('https://i/1', new Blob(['a']));
  await saveImageBlob('https://i/2', new Blob(['b']));
});

describe('restoreHydrationFromInventory', () => {
  it('sets imageHydration to done when blobs exist', async () => {
    const { restoreHydrationFromInventory } = await import('./restore-hydration');
    const { imageHydration } = await import('./hydration-state');
    const inv = {
      saves: [
        { uri: 'a', images: [{ url: 'https://i/1' }, { url: 'https://i/2' }, { url: 'https://i/3' }] },
      ],
    };
    await restoreHydrationFromInventory(inv);
    const s = get(imageHydration);
    expect(s.status).toBe('done');
    expect(s.total).toBe(3);
    expect(s.fetched).toBe(2);
    expect(s.failed).toBe(0);
  });

  it('sets articleHydration to done when article_text is present', async () => {
    const { restoreHydrationFromInventory } = await import('./restore-hydration');
    const { articleHydration } = await import('./hydration-state');
    const inv = {
      saves: [
        { uri: '1', embed: { url: 'https://a/1' }, article_text: 'body' },
        { uri: '2', embed: { url: 'https://a/2' } }, // not yet hydrated
      ],
    };
    await restoreHydrationFromInventory(inv);
    const s = get(articleHydration);
    expect(s.status).toBe('done');
    expect(s.total).toBe(2);
    expect(s.fetched).toBe(1);
  });

  it('restores image counts even when image backup is not enabled (off-state row needs them)', async () => {
    const { restoreHydrationFromInventory } = await import('./restore-hydration');
    const { imageHydration } = await import('./hydration-state');
    const inv = {
      saves: [
        { uri: 'a', images: [{ url: 'https://i/1' }, { url: 'https://i/2' }, { url: 'https://i/3' }] },
      ],
    };
    await restoreHydrationFromInventory(inv);
    const s = get(imageHydration);
    expect(s.status).toBe('done');
    expect(s.total).toBe(3);
  });

  it('restores article counts even when article backup is not enabled', async () => {
    const { restoreHydrationFromInventory } = await import('./restore-hydration');
    const { articleHydration } = await import('./hydration-state');
    const inv = {
      saves: [{ uri: '1', embed: { url: 'https://a/1' }, article_text: 'body' }],
    };
    await restoreHydrationFromInventory(inv);
    const s = get(articleHydration);
    expect(s.status).toBe('done');
    expect(s.total).toBe(1);
    expect(s.fetched).toBe(1);
  });

  it('leaves stores in idle state when inventory has no assets', async () => {
    const { restoreHydrationFromInventory } = await import('./restore-hydration');
    const { imageHydration, articleHydration } = await import('./hydration-state');
    await restoreHydrationFromInventory({ saves: [{ uri: 'x' }] });
    expect(get(imageHydration).status).toBe('idle');
    expect(get(articleHydration).status).toBe('idle');
  });
});
