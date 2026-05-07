import type { ComponentType } from 'svelte';
import SignIn from '$routes/SignIn.svelte';
import Library from '$routes/Library.svelte';
import Post from '$routes/Post.svelte';
import Settings from '$routes/Settings.svelte';
import Privacy from '$routes/Privacy.svelte';
import NotFound from '$routes/NotFound.svelte';

export interface RouteDef {
  readonly name: string;
  readonly pattern: RegExp;
  readonly paramNames: readonly string[];
  readonly component: ComponentType;
}

export const routes: readonly RouteDef[] = [
  { name: 'sign-in', pattern: /^\/$/, paramNames: [], component: SignIn },
  { name: 'library', pattern: /^\/library$/, paramNames: [], component: Library },
  { name: 'post', pattern: /^\/post\/([^/]+)$/, paramNames: ['rkey'], component: Post },
  { name: 'settings', pattern: /^\/settings$/, paramNames: [], component: Settings },
  { name: 'privacy', pattern: /^\/privacy$/, paramNames: [], component: Privacy },
];

export const notFoundRoute: RouteDef = {
  name: 'not-found',
  pattern: /.*/,
  paramNames: [],
  component: NotFound,
};
