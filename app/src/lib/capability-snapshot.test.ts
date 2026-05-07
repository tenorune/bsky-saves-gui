import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT, type CapabilitySnapshot } from './capability-snapshot';

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
