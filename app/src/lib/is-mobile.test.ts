import { describe, it, expect } from 'vitest';
import { checkIsMobileOs } from './is-mobile';

// Phone / tablet / desktop user-agent strings as observed in the wild.
// We don't need to be exhaustive — just cover the major axes the helper
// must classify correctly.
const UA = {
  // Real phones — should be true.
  iPhone16_Safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  pixel9_Chrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iPodTouch: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  // Tablets — should be true.
  iPadOS17_reportsAsIPad: 'Mozilla/5.0 (iPad; CPU OS 13_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  iPadOS17_reportsAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Desktops — should be false.
  macOSSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
};

describe('checkIsMobileOs', () => {
  describe('via navigator.userAgentData.mobile (Chromium)', () => {
    it('returns true when userAgentData.mobile is true', () => {
      expect(checkIsMobileOs({
        userAgent: UA.pixel9_Chrome,
        userAgentData: { mobile: true },
        maxTouchPoints: 5,
      })).toBe(true);
    });

    it('returns false on desktop Chromium where userAgentData.mobile is false', () => {
      expect(checkIsMobileOs({
        userAgent: UA.windowsChrome,
        userAgentData: { mobile: false },
        maxTouchPoints: 0,
      })).toBe(false);
    });
  });

  describe('via user-agent fallback (Safari, Firefox, older Chrome)', () => {
    it('returns true for an iPhone', () => {
      expect(checkIsMobileOs({ userAgent: UA.iPhone16_Safari })).toBe(true);
    });

    it('returns true for an iPad reporting as iPad', () => {
      expect(checkIsMobileOs({ userAgent: UA.iPadOS17_reportsAsIPad })).toBe(true);
    });

    it('returns true for an iPad reporting as Mac with touch points (iPadOS 13+ Safari quirk)', () => {
      expect(checkIsMobileOs({
        userAgent: UA.iPadOS17_reportsAsMac,
        maxTouchPoints: 5,
      })).toBe(true);
    });

    it('returns true for an iPod touch', () => {
      expect(checkIsMobileOs({ userAgent: UA.iPodTouch })).toBe(true);
    });

    it('returns true for an Android phone', () => {
      expect(checkIsMobileOs({ userAgent: UA.pixel9_Chrome })).toBe(true);
    });

    it('returns true for an Android tablet (no "Mobi", still Android)', () => {
      expect(checkIsMobileOs({ userAgent: UA.androidTablet })).toBe(true);
    });

    it('returns false for desktop Safari on Mac (no touch points)', () => {
      expect(checkIsMobileOs({
        userAgent: UA.macOSSafari,
        maxTouchPoints: 0,
      })).toBe(false);
    });

    it('returns false for Windows Chrome', () => {
      expect(checkIsMobileOs({ userAgent: UA.windowsChrome })).toBe(false);
    });

    it('returns false for Linux Firefox', () => {
      expect(checkIsMobileOs({ userAgent: UA.linuxFirefox })).toBe(false);
    });
  });

  describe('robustness', () => {
    it('returns false on an empty / missing user-agent', () => {
      expect(checkIsMobileOs({})).toBe(false);
      expect(checkIsMobileOs({ userAgent: '' })).toBe(false);
    });

    it('does not false-positive a Mac with maxTouchPoints === 1 (single-touch trackpad)', () => {
      // Some Mac trackpad input reports maxTouchPoints === 1 in older browsers.
      // The iPad-via-Mac quirk requires > 1 to discriminate.
      expect(checkIsMobileOs({
        userAgent: UA.macOSSafari,
        maxTouchPoints: 1,
      })).toBe(false);
    });
  });
});
