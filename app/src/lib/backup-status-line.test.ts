import { describe, expect, it } from 'vitest';
import { buildBackupStatusLine } from './backup-status-line';

const idle = { status: 'idle' as const, total: 0, fetched: 0, skipped: 0, failed: 0, failures: [] };

describe('buildBackupStatusLine', () => {
  it('idle + backend available shows "would use ..."', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: idle,
      backendDescription: 'the local helper (bsky-saves 0.3.0)',
    });
    expect(r.text).toBe('Not yet saved · would use the local helper (bsky-saves 0.3.0)');
    expect(r.link).toBeNull();
  });

  it('idle + no backend shows "Set up a backend" link', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: idle,
      backendDescription: null,
    });
    expect(r.text).toBe('Not yet saved · no backend available — Set up a backend');
    expect(r.link).toEqual({ kind: 'setup', phrase: 'Set up a backend' });
  });

  it('running shows "Saving X of N images…"', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'running', total: 47, fetched: 11, skipped: 1, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Saving 12 of 47 images…');
    expect(r.link).toBeNull();
  });

  it('done with no failures shows "X of N images saved"', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 5, fetched: 5, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('5 of 5 images saved');
  });

  it('done with failures shows the failed count', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: {
        status: 'done', total: 5, fetched: 3, skipped: 0, failed: 2,
        failures: [{ url: 'a', reason: 'x' }, { url: 'b', reason: 'y' }],
      },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('3 of 5 images saved (2 failed)');
  });

  it('cancelled shows "Stopped at X of N"', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: { status: 'cancelled', total: 10, fetched: 4, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Stopped at 4 of 10 articles');
  });

  it('uses singular noun when total === 1', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 1, fetched: 1, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('1 of 1 image saved');
  });

  it('article noun', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: { status: 'running', total: 3, fetched: 1, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Saving 1 of 3 articles…');
  });
});
