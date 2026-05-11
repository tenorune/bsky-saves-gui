import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  loadOperatorProxyOptOut,
  setOperatorProxyOptOut,
  clearOperatorProxyOptOut,
} from './operator-proxy-opt-out';

beforeEach(async () => {
  await clearOperatorProxyOptOut();
});

describe('operator-proxy-opt-out', () => {
  it('defaults to false when nothing is stored', async () => {
    expect(await loadOperatorProxyOptOut()).toBe(false);
  });

  it('round-trips set → load', async () => {
    await setOperatorProxyOptOut(true);
    expect(await loadOperatorProxyOptOut()).toBe(true);
    await setOperatorProxyOptOut(false);
    expect(await loadOperatorProxyOptOut()).toBe(false);
  });

  it('clear restores the default', async () => {
    await setOperatorProxyOptOut(true);
    await clearOperatorProxyOptOut();
    expect(await loadOperatorProxyOptOut()).toBe(false);
  });
});
