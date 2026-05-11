import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('router', () => {
  beforeEach(() => {
    window.location.hash = '';
    vi.resetModules();
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

  it('redirects #/run to the library route (legacy)', async () => {
    window.location.hash = '#/run';
    const { currentRoute, startRouter } = await import('./router');
    const stop = startRouter();
    try {
      expect(get(currentRoute).name).toBe('library');
    } finally {
      stop();
    }
  });

  it('redirects #/refresh to the library route (legacy)', async () => {
    window.location.hash = '#/refresh';
    const { currentRoute, startRouter } = await import('./router');
    const stop = startRouter();
    try {
      expect(get(currentRoute).name).toBe('library');
    } finally {
      stop();
    }
  });
});

describe('in-app navigation flag', () => {
  beforeEach(() => {
    window.location.hash = '';
    vi.resetModules();
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('starts false at module init (cold-load mount should not animate)', async () => {
    const { getAndConsumeInAppNav } = await import('./router');
    expect(getAndConsumeInAppNav()).toBe(false);
  });

  it('startRouter does NOT set the flag (an external URL hitting the app should not animate)', async () => {
    window.location.hash = '#/library';
    const { startRouter, getAndConsumeInAppNav } = await import('./router');
    const stop = startRouter();
    try {
      expect(getAndConsumeInAppNav()).toBe(false);
    } finally {
      stop();
    }
  });

  it('navigate sets the flag (next route mount animates)', async () => {
    const { startRouter, navigate, getAndConsumeInAppNav } = await import('./router');
    const stop = startRouter();
    try {
      // Drain the cold-load read first so the flag reflects only what
      // navigate() sets.
      getAndConsumeInAppNav();
      navigate('/library');
      expect(getAndConsumeInAppNav()).toBe(true);
    } finally {
      stop();
    }
  });

  it('flag is consume-once (subsequent reads return false)', async () => {
    const { startRouter, navigate, getAndConsumeInAppNav } = await import('./router');
    const stop = startRouter();
    try {
      getAndConsumeInAppNav();
      navigate('/library');
      expect(getAndConsumeInAppNav()).toBe(true);
      expect(getAndConsumeInAppNav()).toBe(false);
    } finally {
      stop();
    }
  });

  it('navigate(path, { animate: false }) does NOT set the flag', async () => {
    const { startRouter, navigate, getAndConsumeInAppNav } = await import('./router');
    const stop = startRouter();
    try {
      getAndConsumeInAppNav();
      navigate('/library', { animate: false });
      expect(getAndConsumeInAppNav()).toBe(false);
    } finally {
      stop();
    }
  });

  it('hashchange (e.g., address-bar edit) does not set the flag', async () => {
    const { startRouter, getAndConsumeInAppNav } = await import('./router');
    const stop = startRouter();
    try {
      getAndConsumeInAppNav();
      // Simulate an address-bar edit by setting the hash directly and
      // dispatching the same event the browser would fire.
      window.location.hash = '#/library';
      window.dispatchEvent(new Event('hashchange'));
      expect(getAndConsumeInAppNav()).toBe(false);
    } finally {
      stop();
    }
  });
});
