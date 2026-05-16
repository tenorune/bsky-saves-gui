import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { clear, get as idbGet } from 'idb-keyval';
import { loadHelperOptOut, setHelperOptOut, clearHelperOptOut } from './helper-opt-out';

describe('helper-opt-out', () => {
  beforeEach(async () => {
    await clear();
  });

  it('defaults to false', async () => {
    expect(await loadHelperOptOut()).toBe(false);
  });

  it('setHelperOptOut(true) persists and reads back true', async () => {
    await setHelperOptOut(true);
    expect(await loadHelperOptOut()).toBe(true);
    expect(await idbGet('helper-opt-out:v1')).toBe(true);
  });

  it('setHelperOptOut(false) persists and reads back false', async () => {
    await setHelperOptOut(true);
    await setHelperOptOut(false);
    expect(await loadHelperOptOut()).toBe(false);
  });

  it('clearHelperOptOut removes the persisted key and reverts to default', async () => {
    await setHelperOptOut(true);
    await clearHelperOptOut();
    expect(await loadHelperOptOut()).toBe(false);
    expect(await idbGet('helper-opt-out:v1')).toBeUndefined();
  });

  it('treats stored non-true values as false (defensive against schema drift)', async () => {
    const { set: idbSet } = await import('idb-keyval');
    await idbSet('helper-opt-out:v1', 'true'); // string, not boolean
    expect(await loadHelperOptOut()).toBe(false);
  });
});
