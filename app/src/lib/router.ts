import { writable, type Readable } from 'svelte/store';
import { routes, notFoundRoute, type RouteDef } from './routes';
import { decideNavDirection, type NavDirection } from './nav-direction';

export interface ActiveRoute {
  readonly name: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly def: RouteDef;
}

// Direction of the most recent navigation. Read by the route slide-in
// transition so each route can mount with the right entry animation
// without each route having to know what came before. Initial mount has
// no prior route — treat it as 'forward' so the first paint slides in
// from the right (consistent with the previous behavior on cold start).
let lastNavDirection: NavDirection = 'forward';
export function getLastNavDirection(): NavDirection {
  return lastNavDirection;
}

// Set by navigate() to mark "this route change came from an in-app
// click / button / programmatic call." Consumed by the slide action
// at the next route mount. Cold-load mounts and external changes
// (browser back/forward, address-bar edits) leave this false so the
// slide action no-ops — animation is reserved for in-app navigation.
//
// Consume-on-read: each call to getAndConsumeInAppNav() resets the
// flag, so a navigate() that doesn't actually change the route (no
// remount) doesn't leave a stale "true" lying around for a later
// external change to inherit.
let nextNavIsInApp = false;
export function getAndConsumeInAppNav(): boolean {
  const v = nextNavIsInApp;
  nextNavIsInApp = false;
  return v;
}

function parsePath(path: string): ActiveRoute {
  let normalized = path.length === 0 || path === '/' ? '/' : path;
  // Legacy redirects: /run and /refresh were replaced by the Library hub.
  if (normalized === '/run' || normalized === '/refresh') {
    normalized = '/library';
    if (typeof window !== 'undefined') {
      window.location.hash = '#/library';
    }
  }
  for (const def of routes) {
    const match = def.pattern.exec(normalized);
    if (match) {
      const params: Record<string, string> = {};
      def.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1] ?? '');
      });
      return { name: def.name, path: normalized, params, def };
    }
  }
  return { name: notFoundRoute.name, path: normalized, params: {}, def: notFoundRoute };
}

function readHash(): string {
  const raw = window.location.hash;
  if (raw.length === 0) return '/';
  return raw.startsWith('#') ? raw.slice(1) : raw;
}

const store = writable<ActiveRoute>(parsePath(readHash()));

export const currentRoute: Readable<ActiveRoute> = { subscribe: store.subscribe };

function setRoute(next: ActiveRoute): void {
  store.update((prev) => {
    if (prev.name !== next.name) {
      lastNavDirection = decideNavDirection(prev.name, next.name);
    }
    return next;
  });
}

export interface NavigateOptions {
  /**
   * When false, the next route mount will not run the slide animation.
   * Useful for app-driven redirects where the user didn't click
   * anything (e.g., the cold-start decideEntryRoute redirect from / to
   * /library when a cached inventory exists). Defaults to true so
   * normal in-app links and buttons keep their feedback animation.
   */
  readonly animate?: boolean;
}

export function navigate(path: string, opts: NavigateOptions = {}): void {
  if (!path.startsWith('/')) {
    throw new Error(`navigate() requires an absolute path, got: ${path}`);
  }
  if (opts.animate !== false) nextNavIsInApp = true;
  window.location.hash = `#${path}`;
  setRoute(parsePath(path));
}

export function startRouter(): () => void {
  const handler = () => setRoute(parsePath(readHash()));
  setRoute(parsePath(readHash()));
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
