import { describe, expect, it } from 'vitest';
import {
  isHelperOutdated,
  isProtocolNewerThanKnown,
  MAX_KNOWN_PROTOCOL,
  MIN_HELPER_VERSION,
} from './min-helper-version';

describe('isHelperOutdated', () => {
  it('treats versions older than the minimum as outdated', () => {
    expect(isHelperOutdated('0.6.1')).toBe(true);
    expect(isHelperOutdated('0.6.0')).toBe(true);
    expect(isHelperOutdated('0.5.3')).toBe(true);
    expect(isHelperOutdated('0.4.1')).toBe(true);
    expect(isHelperOutdated('0.3.0')).toBe(true);
    expect(isHelperOutdated('0.0.1')).toBe(true);
  });

  it('treats the minimum exactly as not outdated', () => {
    expect(isHelperOutdated(MIN_HELPER_VERSION)).toBe(false);
  });

  it('treats newer versions as not outdated', () => {
    expect(isHelperOutdated('0.6.3')).toBe(false);
    expect(isHelperOutdated('0.7.0')).toBe(false);
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

describe('isProtocolNewerThanKnown', () => {
  it('returns false when helper protocol is at the GUI ceiling', () => {
    expect(isProtocolNewerThanKnown(MAX_KNOWN_PROTOCOL)).toBe(false);
    expect(isProtocolNewerThanKnown('2', '2')).toBe(false);
  });

  it('returns false when helper protocol is below the ceiling', () => {
    expect(isProtocolNewerThanKnown('1', '2')).toBe(false);
    expect(isProtocolNewerThanKnown('1', '5')).toBe(false);
  });

  it('returns true when helper protocol exceeds the ceiling', () => {
    expect(isProtocolNewerThanKnown('3', '2')).toBe(true);
    expect(isProtocolNewerThanKnown('5', '2')).toBe(true);
  });

  it('compares numerically, not lexicographically (10 > 2, not 10 < 2)', () => {
    // The bug this guards: protocol is integer-as-string per the spec,
    // but string comparison would treat "10" < "2" because "1" < "2"
    // codepoint-wise. Numeric comparison is required.
    expect(isProtocolNewerThanKnown('10', '2')).toBe(true);
    expect(isProtocolNewerThanKnown('11', '9')).toBe(true);
  });

  it('returns false for undefined / null / non-string input (pre-v0.6.1 helpers)', () => {
    // Old helpers don't return `protocol`; the caller passes undefined.
    // We err on the side of NOT triggering the banner.
    expect(isProtocolNewerThanKnown(undefined)).toBe(false);
    expect(isProtocolNewerThanKnown(null)).toBe(false);
  });

  it('returns false for non-numeric protocol values (wire-format glitch)', () => {
    // If a future helper returns "v2" or "1.0" the regex test for
    // wire-format violation upstream would already reject the payload —
    // but if it slips through, we still don't spam the banner.
    expect(isProtocolNewerThanKnown('v2')).toBe(false);
    expect(isProtocolNewerThanKnown('')).toBe(false);
    expect(isProtocolNewerThanKnown('abc')).toBe(false);
  });
});
