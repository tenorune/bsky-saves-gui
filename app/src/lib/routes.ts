import type { ComponentType } from 'svelte';

export interface RouteDef {
  readonly name: string;
  readonly pattern: RegExp;
  readonly paramNames: readonly string[];
  /**
   * Dynamic import of the route's Svelte component. The router /
   * App.svelte resolves this on first navigation and the bundler
   * code-splits each route into its own chunk so the initial main
   * bundle stays small. Repeat navigations to a previously-loaded
   * route hit the module loader's cache and resolve synchronously.
   */
  readonly loadComponent: () => Promise<ComponentType>;
}

const lazy = (importer: () => Promise<{ default: ComponentType }>): (() => Promise<ComponentType>) =>
  () => importer().then((m) => m.default);

export const routes: readonly RouteDef[] = [
  { name: 'sign-in',  pattern: /^\/$/,                paramNames: [],       loadComponent: lazy(() => import('$routes/SignIn.svelte')) },
  { name: 'library',  pattern: /^\/library$/,         paramNames: [],       loadComponent: lazy(() => import('$routes/Library.svelte')) },
  { name: 'post',     pattern: /^\/post\/([^/]+)$/,   paramNames: ['rkey'], loadComponent: lazy(() => import('$routes/Post.svelte')) },
  { name: 'settings', pattern: /^\/settings$/,        paramNames: [],       loadComponent: lazy(() => import('$routes/Settings.svelte')) },
  { name: 'privacy',  pattern: /^\/privacy$/,         paramNames: [],       loadComponent: lazy(() => import('$routes/Privacy.svelte')) },
];

export const notFoundRoute: RouteDef = {
  name: 'not-found',
  pattern: /.*/,
  paramNames: [],
  loadComponent: lazy(() => import('$routes/NotFound.svelte')),
};
