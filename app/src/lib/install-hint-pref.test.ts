import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { installHintDismissed, dismissInstallHint, restoreInstallHint, loadInstallHintPref, clearInstallHintPref, _resetInstallHintForTests } from './install-hint-pref';
import { clear, get as idbGet } from 'idb-keyval';

describe('installHintDismissed', () => {
  beforeEach(async () => {
    await clear();
    _resetInstallHintForTests();
  });

  it('defaults to false', () => {
    expect(get(installHintDismissed)).toBe(false);
  });

  it('dismissInstallHint sets true and persists', async () => {
    await dismissInstallHint();
    expect(get(installHintDismissed)).toBe(true);
    _resetInstallHintForTests();
    await loadInstallHintPref();
    expect(get(installHintDismissed)).toBe(true);
  });

  it('restoreInstallHint sets false and persists', async () => {
    await dismissInstallHint();
    await restoreInstallHint();
    expect(get(installHintDismissed)).toBe(false);
  });

  it('clearInstallHintPref resets store to default and removes the IDB entry', async () => {
    await dismissInstallHint();
    expect(get(installHintDismissed)).toBe(true);
    expect(await idbGet('install-hint-dismissed:v1')).toBe(true);

    await clearInstallHintPref();

    expect(get(installHintDismissed)).toBe(false);
    expect(await idbGet('install-hint-dismissed:v1')).toBeUndefined();
  });
});
