import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const { clearFailures } = await import('./failure-store');
  await clearFailures();
});

describe('failure-store', () => {
  it('round-trips per domain', async () => {
    const { saveFailures, loadFailures } = await import('./failure-store');
    await saveFailures('images', [
      { url: 'https://i/1', reason: 'timeout' },
      { url: 'https://i/2', reason: '404' },
    ]);
    await saveFailures('articles', [{ url: 'https://a/1', reason: 'paywall' }]);
    expect(await loadFailures('images')).toEqual([
      { url: 'https://i/1', reason: 'timeout' },
      { url: 'https://i/2', reason: '404' },
    ]);
    expect(await loadFailures('articles')).toEqual([
      { url: 'https://a/1', reason: 'paywall' },
    ]);
  });

  it('saving an empty array clears the persisted entry', async () => {
    const { saveFailures, loadFailures } = await import('./failure-store');
    await saveFailures('images', [{ url: 'https://i/1', reason: 'x' }]);
    await saveFailures('images', []);
    expect(await loadFailures('images')).toEqual([]);
  });

  it('returns [] for missing keys', async () => {
    const { loadFailures } = await import('./failure-store');
    expect(await loadFailures('images')).toEqual([]);
    expect(await loadFailures('articles')).toEqual([]);
  });

  it('filters out malformed entries', async () => {
    const { set } = await import('idb-keyval');
    await set('failures:images:v1', [
      { url: 'https://i/1', reason: 'ok' },
      { reason: 'no url' },
      { url: 42, reason: 'bad type' },
      'string',
      null,
    ]);
    const { loadFailures } = await import('./failure-store');
    expect(await loadFailures('images')).toEqual([{ url: 'https://i/1', reason: 'ok' }]);
  });

  it('clearFailures with no arg clears both domains', async () => {
    const { saveFailures, loadFailures, clearFailures } = await import('./failure-store');
    await saveFailures('images', [{ url: 'https://i/1', reason: 'x' }]);
    await saveFailures('articles', [{ url: 'https://a/1', reason: 'y' }]);
    await clearFailures();
    expect(await loadFailures('images')).toEqual([]);
    expect(await loadFailures('articles')).toEqual([]);
  });
});
