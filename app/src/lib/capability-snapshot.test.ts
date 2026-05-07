import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT, type CapabilitySnapshot, computeCapabilitySnapshot } from './capability-snapshot';
import type { HelperStatus } from './helper-client';

const helperWith = (features: string[], version = '0.4.1'): HelperStatus => ({
  status: 'available',
  version,
  features,
});

describe('CapabilitySnapshot', () => {
  it('EMPTY_SNAPSHOT defaults all routing to non-helper', () => {
    const s: CapabilitySnapshot = EMPTY_SNAPSHOT;
    expect(s.helper).toEqual({ detected: false });
    expect(s.fetch.kind).toBe('pyodide');
    expect(s.enrich.kind).toBe('pyodide');
    expect(s.threads.kind).toBe('pyodide');
    expect(s.images.kind).toBe('operator-worker');
    expect(s.articles.kind).toBe('none');
  });
});

describe('computeCapabilitySnapshot', () => {
  it('routes everything to helper when v0.4.1 advertises all flags', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith(['fetch', 'enrich', 'hydrate-threads', 'jwt-credentials', 'fetch-image', 'extract-article']),
      userWorker: null,
    });
    expect(snap.fetch.kind).toBe('helper');
    expect(snap.enrich.kind).toBe('helper');
    expect(snap.threads.kind).toBe('helper');
    expect(snap.images.kind).toBe('helper');
    expect(snap.articles.kind).toBe('helper');
  });

  it('routes fetch/enrich/threads to pyodide if jwt-credentials missing', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith(['fetch', 'enrich', 'hydrate-threads']),
      userWorker: null,
    });
    expect(snap.fetch.kind).toBe('pyodide');
    expect(snap.enrich.kind).toBe('pyodide');
    expect(snap.threads.kind).toBe('pyodide');
  });

  it('routes fetch/enrich/threads to pyodide if any of fetch/enrich/hydrate-threads missing', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith(['fetch', 'enrich', 'jwt-credentials']),
      userWorker: null,
    });
    expect(snap.threads.kind).toBe('pyodide');
  });

  it('routes images to user-worker when configured and helper lacks fetch-image', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith(['fetch']),
      userWorker: { url: 'https://my.worker.dev' },
    });
    expect(snap.images).toEqual({ kind: 'user-worker', url: 'https://my.worker.dev' });
  });

  it('routes images to operator-worker when no helper image support and no user worker', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith([]),
      userWorker: null,
    });
    expect(snap.images).toEqual({ kind: 'operator-worker' });
  });

  it('routes articles to none when helper lacks extract-article and no user worker', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith([]),
      userWorker: null,
    });
    expect(snap.articles).toEqual({ kind: 'none' });
  });

  it('routes articles to user-worker when configured and helper lacks extract-article', () => {
    const snap = computeCapabilitySnapshot({
      helper: helperWith([]),
      userWorker: { url: 'https://my.worker.dev' },
    });
    expect(snap.articles).toEqual({ kind: 'user-worker', url: 'https://my.worker.dev' });
  });

  it('falls back entirely when helper unavailable', () => {
    const snap = computeCapabilitySnapshot({
      helper: { status: 'unavailable' },
      userWorker: null,
    });
    expect(snap.helper.detected).toBe(false);
    expect(snap.fetch.kind).toBe('pyodide');
  });
});
