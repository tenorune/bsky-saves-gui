import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { imageBannerVisible } from './backup-banner-state';

describe('imageBannerVisible store', () => {
  it('defaults to false', () => {
    imageBannerVisible.set(false);
    expect(get(imageBannerVisible)).toBe(false);
  });

  it('round-trips set(true) / set(false)', () => {
    imageBannerVisible.set(true);
    expect(get(imageBannerVisible)).toBe(true);
    imageBannerVisible.set(false);
    expect(get(imageBannerVisible)).toBe(false);
  });
});
