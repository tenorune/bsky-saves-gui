import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  filterQuery,
  filterFrom,
  filterTo,
  filterShow,
  availableShowFilters,
  resetLibraryFilters,
} from './library-filters';

describe('library-filters', () => {
  beforeEach(() => resetLibraryFilters());

  it('starts at empty defaults', () => {
    expect(get(filterQuery)).toBe('');
    expect(get(filterFrom)).toBeNull();
    expect(get(filterTo)).toBeNull();
    expect(get(filterShow)).toBe('synced');
  });

  it('stores values across reads (so they survive a Library remount)', () => {
    filterQuery.set('cats');
    filterFrom.set('2026-01-01');
    filterTo.set('2026-03-31');
    filterShow.set('lost');
    expect(get(filterQuery)).toBe('cats');
    expect(get(filterFrom)).toBe('2026-01-01');
    expect(get(filterTo)).toBe('2026-03-31');
    expect(get(filterShow)).toBe('lost');
  });

  it('resetLibraryFilters clears all back to defaults', () => {
    filterQuery.set('something');
    filterFrom.set('2026-01-01');
    filterTo.set('2026-03-31');
    filterShow.set('all');
    resetLibraryFilters();
    expect(get(filterQuery)).toBe('');
    expect(get(filterFrom)).toBeNull();
    expect(get(filterTo)).toBeNull();
    expect(get(filterShow)).toBe('synced');
  });
});

describe('availableShowFilters', () => {
  it('offers all four categories under keep-all', () => {
    expect(availableShowFilters('keep-all')).toEqual(['synced', 'lost', 'unsaved', 'all']);
  });

  it('drops "unsaved" under keep-lost (un-saved entries are not retained)', () => {
    expect(availableShowFilters('keep-lost')).toEqual(['synced', 'lost', 'all']);
  });

  it('offers only "all" under sync (the control is hidden entirely)', () => {
    expect(availableShowFilters('sync')).toEqual(['all']);
  });
});
