import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Snooze tests fake `Date` only, not setTimeout/queueMicrotask. fake-indexeddb
// rides on real microtasks, so `vi.useFakeTimers()` (which intercepts everything
// by default) hangs IDB transactions. `toFake: ['Date']` lets us pin Date.now()
// for snooze math while leaving the IDB scheduler alive.

beforeEach(async () => {
  const { clearBackupPrefs } = await import('./backup-prefs');
  await clearBackupPrefs();
  vi.useRealTimers();
});

describe('backup-prefs', () => {
  it('returns defaults when nothing is set', async () => {
    const { loadBackupPrefs } = await import('./backup-prefs');
    expect(await loadBackupPrefs()).toEqual({
      images: { snoozeUntil: null, dontAsk: false, enabled: false },
      articles: { snoozeUntil: null, dontAsk: false, enabled: false },
    });
  });

  it('snoozes a feature for 7 days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
    const { snoozeBackupPrompt, loadBackupPrefs } = await import('./backup-prefs');
    await snoozeBackupPrompt('images');
    const prefs = await loadBackupPrefs();
    const seven = 7 * 24 * 60 * 60 * 1000;
    expect(prefs.images.snoozeUntil).toBe(Date.parse('2026-05-04T00:00:00Z') + seven);
    expect(prefs.images.dontAsk).toBe(false);
  });

  it('"dont ask me again" is sticky across reads', async () => {
    const { setBackupDontAsk, loadBackupPrefs } = await import('./backup-prefs');
    await setBackupDontAsk('articles', true);
    expect((await loadBackupPrefs()).articles.dontAsk).toBe(true);
    await setBackupDontAsk('articles', false);
    expect((await loadBackupPrefs()).articles.dontAsk).toBe(false);
  });

  it('shouldShowBackupBanner is true when neither flag suppresses it', async () => {
    const { shouldShowBackupBanner } = await import('./backup-prefs');
    expect(await shouldShowBackupBanner('images')).toBe(true);
  });

  it('shouldShowBackupBanner is false while snoozed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
    const { snoozeBackupPrompt, shouldShowBackupBanner } = await import('./backup-prefs');
    await snoozeBackupPrompt('images');
    expect(await shouldShowBackupBanner('images')).toBe(false);
  });

  it('shouldShowBackupBanner is true again after the snooze elapses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
    const { snoozeBackupPrompt, shouldShowBackupBanner } = await import('./backup-prefs');
    await snoozeBackupPrompt('images');
    vi.setSystemTime(new Date('2026-05-12T00:00:01Z'));
    expect(await shouldShowBackupBanner('images')).toBe(true);
  });

  it('shouldShowBackupBanner is false when dontAsk is set, regardless of snooze', async () => {
    const { setBackupDontAsk, shouldShowBackupBanner } = await import('./backup-prefs');
    await setBackupDontAsk('images', true);
    expect(await shouldShowBackupBanner('images')).toBe(false);
  });

  it('setBackupEnabled persists and round-trips', async () => {
    const { setBackupEnabled, loadBackupPrefs } = await import('./backup-prefs');
    await setBackupEnabled('images', true);
    expect((await loadBackupPrefs()).images.enabled).toBe(true);
    await setBackupEnabled('images', false);
    expect((await loadBackupPrefs()).images.enabled).toBe(false);
  });

  it('shouldShowBackupBanner is false when enabled is true (even without snooze)', async () => {
    const { setBackupEnabled, shouldShowBackupBanner } = await import('./backup-prefs');
    await setBackupEnabled('images', true);
    expect(await shouldShowBackupBanner('images')).toBe(false);
  });

  it('enabled does not affect the OTHER feature', async () => {
    const { setBackupEnabled, shouldShowBackupBanner } = await import('./backup-prefs');
    await setBackupEnabled('images', true);
    expect(await shouldShowBackupBanner('articles')).toBe(true);
  });
});
