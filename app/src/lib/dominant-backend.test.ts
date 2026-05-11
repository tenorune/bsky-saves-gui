import { describe, expect, it } from 'vitest';
import { computeDominantBackend } from './dominant-backend';
import type { CapabilitySnapshot } from './capability-snapshot';

const snap = (overrides: Partial<CapabilitySnapshot>): CapabilitySnapshot => ({
  helper: { detected: false },
  fetch: { kind: 'pyodide' },
  enrich: { kind: 'pyodide' },
  threads: { kind: 'pyodide' },
  images: { kind: 'operator-worker' },
  articles: { kind: 'none' },
  loaded: true,
  ...overrides,
});

describe('computeDominantBackend', () => {
  it('returns "local helper" when all three asset paths use helper', () => {
    expect(computeDominantBackend(snap({
      threads: { kind: 'helper' }, images: { kind: 'helper' }, articles: { kind: 'helper' },
    }))).toBe('local helper');
  });

  it('returns null when there is no clear majority', () => {
    expect(computeDominantBackend(snap({
      threads: { kind: 'pyodide' }, images: { kind: 'operator-worker' }, articles: { kind: 'none' },
    }))).toBeNull();
  });

  it('returns null when no row has a label-able backend (pyodide implicit)', () => {
    // threads: pyodide, images: operator-worker, articles: none — no consensus.
    expect(computeDominantBackend(snap({}))).toBeNull();
  });
});
