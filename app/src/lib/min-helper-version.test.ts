import { describe, expect, it } from 'vitest';
import { isHelperOutdated, MIN_HELPER_VERSION } from './min-helper-version';

describe('isHelperOutdated', () => {
  it('treats versions older than the minimum as outdated', () => {
    expect(isHelperOutdated('0.3.1')).toBe(true);
    expect(isHelperOutdated('0.3.0')).toBe(true);
    expect(isHelperOutdated('0.2.9')).toBe(true);
    expect(isHelperOutdated('0.0.1')).toBe(true);
  });

  it('treats the minimum exactly as not outdated', () => {
    expect(isHelperOutdated(MIN_HELPER_VERSION)).toBe(false);
  });

  it('treats newer versions as not outdated', () => {
    expect(isHelperOutdated('0.4.1')).toBe(false);
    expect(isHelperOutdated('0.5.0')).toBe(false);
    expect(isHelperOutdated('1.0.0')).toBe(false);
  });

  it('handles two-segment versions', () => {
    expect(isHelperOutdated('0.3', '0.3.1')).toBe(true);
    expect(isHelperOutdated('0.4', '0.3.1')).toBe(false);
  });

  it('handles non-numeric segments by treating them as 0', () => {
    expect(isHelperOutdated('0.3.x', '0.3.1')).toBe(true);
    expect(isHelperOutdated('', '0.3.1')).toBe(true);
  });

  it('accepts a custom minimum', () => {
    expect(isHelperOutdated('1.0.0', '2.0.0')).toBe(true);
    expect(isHelperOutdated('2.0.0', '2.0.0')).toBe(false);
    expect(isHelperOutdated('3.0.0', '2.0.0')).toBe(false);
  });
});
