import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { filterQuery, filterFrom, filterTo, resetLibraryFilters } from './library-filters';

describe('library-filters', () => {
  beforeEach(() => resetLibraryFilters());

  it('starts at empty defaults', () => {
    expect(get(filterQuery)).toBe('');
    expect(get(filterFrom)).toBeNull();
    expect(get(filterTo)).toBeNull();
  });

  it('stores values across reads (so they survive a Library remount)', () => {
    filterQuery.set('cats');
    filterFrom.set('2026-01-01');
    filterTo.set('2026-03-31');
    expect(get(filterQuery)).toBe('cats');
    expect(get(filterFrom)).toBe('2026-01-01');
    expect(get(filterTo)).toBe('2026-03-31');
  });

  it('resetLibraryFilters clears all three back to defaults', () => {
    filterQuery.set('something');
    filterFrom.set('2026-01-01');
    filterTo.set('2026-03-31');
    resetLibraryFilters();
    expect(get(filterQuery)).toBe('');
    expect(get(filterFrom)).toBeNull();
    expect(get(filterTo)).toBeNull();
  });
});
