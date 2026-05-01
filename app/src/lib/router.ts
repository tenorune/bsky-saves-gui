import { writable, type Readable } from 'svelte/store';
import { routes, notFoundRoute, type RouteDef } from './routes';

export interface ActiveRoute {
  readonly name: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly def: RouteDef;
}

function parsePath(path: string): ActiveRoute {
  const normalized = path.length === 0 || path === '/' ? '/' : path;
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

export function navigate(path: string): void {
  if (!path.startsWith('/')) {
    throw new Error(`navigate() requires an absolute path, got: ${path}`);
  }
  window.location.hash = `#${path}`;
  store.set(parsePath(path));
}

export function startRouter(): () => void {
  const handler = () => store.set(parsePath(readHash()));
  store.set(parsePath(readHash()));
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
