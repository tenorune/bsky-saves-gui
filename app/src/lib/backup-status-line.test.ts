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
  });

  it('idle + no backend reads "no backend available" with no inline link', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: idle,
      backendDescription: null,
    });
    expect(r.text).toBe('Not yet saved · no backend available');
  });

  it('running appends backend info', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'running', total: 47, fetched: 11, skipped: 1, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Saving 12 of 47 images… · using the local helper');
  });

  it('done with no failures appends backend info', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 5, fetched: 5, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('5 of 5 images saved · using the local helper');
  });

  it('done with failures appends backend info', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: {
        status: 'done', total: 5, fetched: 3, skipped: 0, failed: 2,
        failures: [{ url: 'a', reason: 'x' }, { url: 'b', reason: 'y' }],
      },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('3 of 5 images saved (2 failed) · using the local helper');
  });

  it('cancelled appends backend info', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: { status: 'cancelled', total: 10, fetched: 4, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Stopped at 4 of 10 articles · using the local helper');
  });

  it('done without backend description omits the suffix', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 5, fetched: 5, skipped: 0, failed: 0, failures: [] },
      backendDescription: null,
    });
    expect(r.text).toBe('5 of 5 images saved');
  });

  it('uses singular noun when total === 1', () => {
    const r = buildBackupStatusLine({
      domain: 'images',
      hydration: { status: 'done', total: 1, fetched: 1, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('1 of 1 image saved · using the local helper');
  });

  it('article noun', () => {
    const r = buildBackupStatusLine({
      domain: 'articles',
      hydration: { status: 'running', total: 3, fetched: 1, skipped: 0, failed: 0, failures: [] },
      backendDescription: 'the local helper',
    });
    expect(r.text).toBe('Saving 1 of 3 articles… · using the local helper');
  });
});
