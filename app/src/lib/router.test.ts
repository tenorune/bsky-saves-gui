import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

describe('router', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('parses an empty hash to the root route', async () => {
    const { currentRoute, startRouter } = await import('./router');
    const stop = startRouter();
    try {
      expect(get(currentRoute).path).toBe('/');
    } finally {
      stop();
    }
  });

  it('parses a hash route into path and params', async () => {
    window.location.hash = '#/post/abc123';
    const { currentRoute, startRouter } = await import('./router');
    const stop = startRouter();
    try {
      const r = get(currentRoute);
      expect(r.path).toBe('/post/abc123');
      expect(r.params).toEqual({ rkey: 'abc123' });
      expect(r.name).toBe('post');
    } finally {
      stop();
    }
  });

  it('updates the store when the hash changes', async () => {
    const { currentRoute, startRouter, navigate } = await import('./router');
    const stop = startRouter();
    try {
      navigate('/library');
      // hashchange is dispatched synchronously by setting hash; flush microtasks
      await Promise.resolve();
      expect(get(currentRoute).name).toBe('library');
      expect(window.location.hash).toBe('#/library');
    } finally {
      stop();
    }
  });

  it('falls back to not-found for unknown paths', async () => {
    window.location.hash = '#/totally-unknown';
    const { currentRoute, startRouter } = await import('./router');
    const stop = startRouter();
    try {
      expect(get(currentRoute).name).toBe('not-found');
    } finally {
      stop();
    }
  });

  it('routes #/run to the run route', async () => {
    window.location.hash = '#/run';
    const { currentRoute, startRouter } = await import('./router');
    const stop = startRouter();
    try {
      expect(get(currentRoute).name).toBe('run');
    } finally {
      stop();
    }
  });
});
