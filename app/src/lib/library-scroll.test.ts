import { describe, expect, it, beforeEach } from 'vitest';
import { saveLibraryScroll, consumeLibraryScroll, _resetLibraryScrollForTests } from './library-scroll';

describe('library-scroll', () => {
  beforeEach(() => _resetLibraryScrollForTests());

  it('returns null when nothing has been saved', () => {
    expect(consumeLibraryScroll()).toBeNull();
  });

  it('captures window.scrollY on save and returns it on consume', () => {
    Object.defineProperty(window, 'scrollY', { value: 480, configurable: true });
    saveLibraryScroll();
    expect(consumeLibraryScroll()).toBe(480);
  });

  it('clears the saved value after consume so a stale position is not reused', () => {
    Object.defineProperty(window, 'scrollY', { value: 240, configurable: true });
    saveLibraryScroll();
    consumeLibraryScroll();
    expect(consumeLibraryScroll()).toBeNull();
  });

  it('overwrites the saved value when save is called twice', () => {
    Object.defineProperty(window, 'scrollY', { value: 100, configurable: true });
    saveLibraryScroll();
    Object.defineProperty(window, 'scrollY', { value: 700, configurable: true });
    saveLibraryScroll();
    expect(consumeLibraryScroll()).toBe(700);
  });
});
