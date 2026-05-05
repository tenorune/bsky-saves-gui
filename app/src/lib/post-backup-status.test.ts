import { describe, expect, it } from 'vitest';
import { getPostBackupStatus } from './post-backup-status';
import type { Save } from '../reader/inventory-shape';

const sampleAuthor = { did: 'd', handle: 'h.example' };
const sampleRecord = { text: 't', createdAt: '2026-05-05T00:00:00Z' };
const baseSave: Save = {
  uri: 'at://x/y/1',
  author: sampleAuthor,
  record: sampleRecord,
};

const idle = { status: 'idle' as const, total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] };
const running = { status: 'running' as const, total: 1, fetched: 0, skipped: 0, failed: 0, failures: [] };

describe('getPostBackupStatus', () => {
  it('hides itself when post has no images and no article', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: [],
      articleUrlInPost: null,
      savedImageUrls: new Set(),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.hasAssets).toBe(false);
  });

  it('returns "Not yet saved — go to Library to save." when a backend is available', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: null,
      savedImageUrls: new Set(),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.summary).toBe('Not yet saved — go to Library to save.');
    expect(r.link).toBe('library');
    expect(r.anyFailed).toBe(false);
  });

  it('returns "Not yet saved — set up a backend." when no backend is available', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: null,
      savedImageUrls: new Set(),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: false,
    });
    expect(r.summary).toBe('Not yet saved — set up a backend.');
    expect(r.link).toBe('setup');
  });

  it('returns "Article saved." for an article-only post that succeeded', () => {
    const r = getPostBackupStatus({
      save: { ...baseSave, article_text: 'hello' } as Save,
      imageUrlsInPost: [],
      articleUrlInPost: 'https://a/1',
      savedImageUrls: new Set(),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.summary).toBe('Article saved.');
    expect(r.article?.state).toBe('saved');
    expect(r.link).toBeNull();
  });

  it('returns "1 of 1 image saved." (singular) for a single saved image', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1'],
      articleUrlInPost: null,
      savedImageUrls: new Set(['https://i/1']),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.summary).toBe('1 of 1 image saved.');
    expect(r.link).toBeNull();
  });

  it('returns "3 of 3 images saved." for all-saved images', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: null,
      savedImageUrls: new Set(['https://i/1', 'https://i/2', 'https://i/3']),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.summary).toBe('3 of 3 images saved.');
    expect(r.anyFailed).toBe(false);
    expect(r.link).toBeNull();
  });

  it('returns "2 of 3 images saved (1 failed)." with anyFailed=true', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: null,
      savedImageUrls: new Set(['https://i/1', 'https://i/2']),
      imageHydration: {
        status: 'done',
        total: 3,
        fetched: 2,
        skipped: 0,
        failed: 1,
        failures: [{ url: 'https://i/3', reason: 'timeout' }],
      },
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.summary).toBe('2 of 3 images saved (1 failed).');
    expect(r.anyFailed).toBe(true);
    expect(r.images.failureReasons).toEqual(['timeout']);
    expect(r.link).toBeNull();
  });

  it('joins images and article with " · " when both are present and saved', () => {
    const r = getPostBackupStatus({
      save: { ...baseSave, article_text: 'x' } as Save,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: 'https://a/1',
      savedImageUrls: new Set(['https://i/1', 'https://i/2', 'https://i/3']),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.summary).toBe('3 of 3 images saved · article saved.');
    expect(r.link).toBeNull();
  });

  it('mixed images + article failed → reports both', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2', 'https://i/3'],
      articleUrlInPost: 'https://a/1',
      savedImageUrls: new Set(['https://i/1', 'https://i/2']),
      imageHydration: {
        status: 'done',
        total: 3,
        fetched: 2,
        skipped: 0,
        failed: 1,
        failures: [{ url: 'https://i/3', reason: 'rate-limited' }],
      },
      articleHydration: {
        status: 'done',
        total: 1,
        fetched: 0,
        skipped: 0,
        failed: 1,
        failures: [{ url: 'https://a/1', reason: 'paywalled' }],
      },
      setupAvailable: true,
    });
    expect(r.summary).toBe('2 of 3 images saved (1 failed) · article failed.');
    expect(r.anyFailed).toBe(true);
    expect(r.article?.reason).toBe('paywalled');
    expect(r.link).toBeNull();
  });

  it('returns "Backing up…" when a hydration store is running with pending assets', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2'],
      articleUrlInPost: null,
      savedImageUrls: new Set(['https://i/1']),
      imageHydration: running,
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.summary).toBe('Backing up…');
    expect(r.hydrating).toBe(true);
    expect(r.link).toBeNull();
  });

  it('images saved · article still pending', () => {
    const r = getPostBackupStatus({
      save: baseSave,
      imageUrlsInPost: ['https://i/1', 'https://i/2'],
      articleUrlInPost: 'https://a/1',
      savedImageUrls: new Set(['https://i/1', 'https://i/2']),
      imageHydration: idle,
      articleHydration: idle,
      setupAvailable: true,
    });
    expect(r.summary).toBe('2 of 2 images saved · article not backed up yet.');
    expect(r.link).toBeNull();
  });
});
