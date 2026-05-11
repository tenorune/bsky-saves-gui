import { describe, it, expect } from 'vitest';
import { decideNavDirection } from './nav-direction';

describe('decideNavDirection — main reading flow', () => {
  it('SignIn → Library = forward', () => {
    expect(decideNavDirection('sign-in', 'library')).toBe('forward');
  });

  it('Library → Post = forward (deeper into the hierarchy)', () => {
    expect(decideNavDirection('library', 'post')).toBe('forward');
  });

  it('Post → Library = backward (returning up)', () => {
    expect(decideNavDirection('post', 'library')).toBe('backward');
  });

  it('Library → SignIn = backward (logging out / clicking app title)', () => {
    expect(decideNavDirection('library', 'sign-in')).toBe('backward');
  });

  it('SignIn → Post = forward (skip-level, still descending)', () => {
    expect(decideNavDirection('sign-in', 'post')).toBe('forward');
  });
});

describe('decideNavDirection — auxiliary routes (settings, privacy)', () => {
  it('Library → Settings = forward (entering aux)', () => {
    expect(decideNavDirection('library', 'settings')).toBe('forward');
  });

  it('Post → Settings = forward (entering aux from deeper in flow)', () => {
    expect(decideNavDirection('post', 'settings')).toBe('forward');
  });

  it('SignIn → Settings = forward', () => {
    expect(decideNavDirection('sign-in', 'settings')).toBe('forward');
  });

  it('Settings → Library = backward (leaving aux returns to flow)', () => {
    expect(decideNavDirection('settings', 'library')).toBe('backward');
  });

  it('Settings → SignIn = backward', () => {
    expect(decideNavDirection('settings', 'sign-in')).toBe('backward');
  });

  it('Settings → Post = backward (leaving aux, regardless of where we re-enter)', () => {
    expect(decideNavDirection('settings', 'post')).toBe('backward');
  });

  it('Privacy behaves the same as Settings: entering = forward', () => {
    expect(decideNavDirection('library', 'privacy')).toBe('forward');
  });

  it('Privacy behaves the same as Settings: leaving = backward', () => {
    expect(decideNavDirection('privacy', 'library')).toBe('backward');
  });
});

describe('decideNavDirection — edge cases', () => {
  it('same route → forward (no-op navigations should not animate backward)', () => {
    expect(decideNavDirection('library', 'library')).toBe('forward');
  });

  it('not-found → forward (no place in the hierarchy, default to enter motion)', () => {
    expect(decideNavDirection('library', 'not-found')).toBe('forward');
  });
});
