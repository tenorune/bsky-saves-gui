/// <reference lib="webworker" />
//
// Custom service worker compiled by vite-plugin-pwa's injectManifest mode.
//
// Strategy summary (see docs/superpowers/specs/2026-05-11-pwa-design.md):
//   - Precache: all hashed assets (JS/CSS/icons/manifest) emitted by the
//     build. `self.__WB_MANIFEST` is filled in at build time.
//   - Navigations (HTML documents): NetworkFirst with a short timeout and
//     a fall-back to the precached index.html. This is the bricking safety
//     net — a fresh HTML always pulls fresh fingerprinted JS on the next
//     online reload.
//   - Pyodide CDN: StaleWhileRevalidate with a size cap. Opportunistic.
//   - Everything else (Bluesky API, helper, cf-worker): passes through to
//     network, never cached. This is the privacy guarantee.
//
// Update flow is silent: sw-register.ts on the page sends SKIP_WAITING when
// a new SW reaches the 'installed' state with an existing controller. The
// new SW activates immediately but doesn't reload tabs; users pick up the
// new build on their next cold load.

import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import type { RouteHandlerCallbackOptions } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const indexFallback = createHandlerBoundToURL('index.html');
const networkFirstNav = new NetworkFirst({
  cacheName: 'navigations',
  networkTimeoutSeconds: 3,
});

registerRoute(
  new NavigationRoute(async (params: RouteHandlerCallbackOptions) => {
    try {
      const res = await networkFirstNav.handle(params);
      if (res) return res;
    } catch {
      // Fall through to precached index.html
    }
    return indexFallback(params);
  }),
);

registerRoute(
  ({ url }: { url: URL }) =>
    url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/pyodide/'),
  new StaleWhileRevalidate({
    cacheName: 'pyodide-cdn',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
