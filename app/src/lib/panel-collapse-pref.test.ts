import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { clear, get as idbGet } from 'idb-keyval';
import {
  panelCollapse,
  loadPanelCollapse,
  setBackupsCollapsed,
  setFiltersCollapsed,
  clearPanelCollapse,
  _resetPanelCollapseForTests,
} from './panel-collapse-pref';

describe('panelCollapse', () => {
  beforeEach(async () => {
    await clear();
    _resetPanelCollapseForTests();
  });

  it('defaults to both collapsed', () => {
    expect(get(panelCollapse)).toEqual({ backups: true, filters: true });
  });

  it('setBackupsCollapsed persists only the backups flag', async () => {
    await setBackupsCollapsed(false);
    expect(get(panelCollapse)).toEqual({ backups: false, filters: true });
    _resetPanelCollapseForTests();
    await loadPanelCollapse();
    expect(get(panelCollapse)).toEqual({ backups: false, filters: true });
  });

  it('setFiltersCollapsed persists only the filters flag', async () => {
    await setFiltersCollapsed(false);
    expect(get(panelCollapse)).toEqual({ backups: true, filters: false });
    _resetPanelCollapseForTests();
    await loadPanelCollapse();
    expect(get(panelCollapse)).toEqual({ backups: true, filters: false });
  });

  it('clearPanelCollapse resets to defaults and removes the IDB entry', async () => {
    await setBackupsCollapsed(false);
    await setFiltersCollapsed(false);
    expect(await idbGet('panel-collapse:v1')).toEqual({ backups: false, filters: false });

    await clearPanelCollapse();

    expect(get(panelCollapse)).toEqual({ backups: true, filters: true });
    expect(await idbGet('panel-collapse:v1')).toBeUndefined();
  });

  it('loadPanelCollapse ignores malformed stored values', async () => {
    // Simulate a stored value from an older or corrupted schema.
    const { set: idbSet } = await import('idb-keyval');
    await idbSet('panel-collapse:v1', { backups: 'yes' });
    await loadPanelCollapse();
    expect(get(panelCollapse)).toEqual({ backups: true, filters: true });
  });
});
