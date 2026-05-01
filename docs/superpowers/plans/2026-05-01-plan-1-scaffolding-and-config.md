# Plan 1 — Repo Scaffolding & Config Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deployable empty shell of the BlueSky Saves Exporter app — Svelte + Vite + TypeScript scaffold with env-driven configuration, a hash-based router, placeholder routes, root README, and a GitHub Pages deploy workflow. After this plan: pushing to `main` produces a live site at the configured domain showing the app shell with working navigation between empty pages.

**Architecture:** Static SPA. Vite builds Svelte 4 + TypeScript into `dist/`. All deployer-specific values flow through `import.meta.env.VITE_*` at build time, with `.env.example` documenting them. A small custom hash router maps `#/path` → component. CNAME is emitted into the build output from `VITE_APP_DOMAIN`. GitHub Actions builds on PRs and deploys on pushes to `main`.

**Tech Stack:** Svelte 4, Vite 5, TypeScript 5, Vitest 2, pnpm 9, Node 20, GitHub Actions, GitHub Pages.

**Reference:** [Design spec](../specs/2026-05-01-bsky-saves-gui-design.md), Configuration section.

---

## File Structure

This plan creates:

```
bsky-saves-gui/
├── .env.example                    # documented reference values for VITE_* vars
├── .gitignore
├── .node-version                   # pin Node 20
├── .npmrc                          # pnpm settings
├── .prettierrc.json
├── README.md
├── index.html                      # Vite entry HTML
├── package.json
├── pnpm-lock.yaml                  # generated
├── svelte.config.js
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── vitest.config.ts
├── app/
│   └── src/
│       ├── main.ts                 # bootstraps Svelte
│       ├── App.svelte              # root layout (header, <Router/>, footer)
│       ├── env.d.ts                # ambient types for VITE_* env
│       ├── lib/
│       │   ├── config.ts           # typed accessor for VITE_* env vars
│       │   ├── config.test.ts
│       │   ├── router.ts           # hash router store + types
│       │   ├── router.test.ts
│       │   └── routes.ts           # route table (path → component)
│       └── routes/                 # placeholder route components
│           ├── SignIn.svelte
│           ├── Library.svelte
│           ├── Post.svelte
│           ├── Settings.svelte
│           ├── Privacy.svelte
│           └── NotFound.svelte
├── app/public/                     # static assets copied verbatim by Vite
├── tools/
│   └── vite-plugin-cname.ts        # emits CNAME from VITE_APP_DOMAIN
└── .github/
    └── workflows/
        ├── ci.yml                  # build + tests on PRs and main
        └── pages.yml               # build + deploy to GitHub Pages on main
```

`LICENSE` already exists at the repo root; do not modify. The `docs/` directory already contains the spec and this plan; do not modify.

---

## Task 1: Project initialization

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `.node-version`

- [ ] **Step 1: Verify pnpm and Node**

Run:
```bash
node --version  # expect v20.x
pnpm --version  # expect 9.x; if missing, run: npm install -g pnpm@9
```

- [ ] **Step 2: Create `.node-version`**

Contents:
```
20
```

- [ ] **Step 3: Create `.npmrc`**

Contents:
```
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 4: Create `.gitignore`**

Contents:
```
node_modules/
dist/
.env
.env.local
.env.*.local
*.log
.DS_Store
.vite/
coverage/
```

- [ ] **Step 5: Create `package.json`**

Contents:
```json
{
  "name": "bsky-saves-gui",
  "version": "0.0.0",
  "private": true,
  "description": "Web GUI for bsky-saves (working title: BlueSky Saves Exporter)",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.1.2",
    "@testing-library/svelte": "^5.2.4",
    "@tsconfig/svelte": "^5.0.4",
    "@types/node": "^20.16.0",
    "jsdom": "^25.0.0",
    "prettier": "^3.3.3",
    "prettier-plugin-svelte": "^3.2.6",
    "svelte": "^4.2.19",
    "svelte-check": "^4.0.4",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  },
  "packageManager": "pnpm@9.12.3"
}
```

- [ ] **Step 6: Install dependencies**

Run:
```bash
pnpm install
```

Expected: lockfile created, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore .npmrc .node-version
git commit -m "chore: initialize pnpm project with Svelte/Vite/TS toolchain"
```

---

## Task 2: TypeScript, Vite, Svelte, and Vitest configuration

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `svelte.config.js`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.prettierrc.json`

- [ ] **Step 1: Create `tsconfig.json`**

Contents:
```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowJs": false,
    "types": ["vite/client", "node"]
  },
  "include": ["app/src/**/*.ts", "app/src/**/*.svelte", "app/src/env.d.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 2: Create `tsconfig.node.json`**

Contents:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts", "vitest.config.ts", "tools/**/*.ts"]
}
```

- [ ] **Step 3: Create `svelte.config.js`**

Contents:
```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
};
```

- [ ] **Step 4: Create `vite.config.ts`**

Contents:
```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'app',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./app/src/lib', import.meta.url)),
      $routes: fileURLToPath(new URL('./app/src/routes', import.meta.url)),
    },
  },
  plugins: [svelte()],
});
```

- [ ] **Step 5: Create `vitest.config.ts`**

Contents:
```ts
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['app/src/**/*.test.ts'],
    },
  }),
);
```

- [ ] **Step 6: Create `.prettierrc.json`**

Contents:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "plugins": ["prettier-plugin-svelte"],
  "overrides": [{ "files": "*.svelte", "options": { "parser": "svelte" } }]
}
```

- [ ] **Step 7: Verify TS compiles**

Run:
```bash
pnpm check
```

Expected: 0 errors, may report no source files yet — that's fine.

- [ ] **Step 8: Commit**

```bash
git add tsconfig.json tsconfig.node.json svelte.config.js vite.config.ts vitest.config.ts .prettierrc.json
git commit -m "chore: add TypeScript, Vite, Svelte, Vitest, and Prettier config"
```

---

## Task 3: Environment variable types and `.env.example`

**Files:**
- Create: `app/src/env.d.ts`
- Create: `.env.example`
- Create: `.env` (local copy, gitignored)

- [ ] **Step 1: Create `app/src/env.d.ts`**

Contents:
```ts
/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_DOMAIN: string;
  readonly VITE_OPERATOR_HANDLE: string;
  readonly VITE_BEACON_AT_URI: string;
  readonly VITE_DEFAULT_PDS: string;
  readonly VITE_HELPER_ORIGIN: string;
  readonly VITE_REPO_URL: string;
  readonly VITE_PYODIDE_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 2: Create `.env.example`**

Contents:
```
# User-visible product name. Working title until a final brand is chosen.
VITE_APP_NAME=BlueSky Saves Exporter

# Canonical hostname this build is deployed to.
# Used for the CNAME file and as the default origin in helper/worker allow-lists.
VITE_APP_DOMAIN=saves.lightseed.net

# Bluesky handle of the deployer. Surfaces in the beacon button label and privacy policy.
VITE_OPERATOR_HANDLE=tenorune.lightseed.net

# AT URI of the pinned beacon post. Leave blank to hide the beacon button.
# Example: at://did:plc:.../app.bsky.feed.post/3lkx...
VITE_BEACON_AT_URI=

# Default PDS pre-filled into the sign-in form.
VITE_DEFAULT_PDS=https://bsky.social

# Loopback origin probed by the helper detector.
VITE_HELPER_ORIGIN=http://127.0.0.1:7878

# Public repository URL, linked from footer and privacy policy.
VITE_REPO_URL=https://github.com/tenorune/bsky-saves-gui

# Pinned Pyodide release. Used by the engine in plan 2.
VITE_PYODIDE_VERSION=0.26.4
```

- [ ] **Step 3: Create local `.env` for development**

Run:
```bash
cp .env.example .env
```

This file is gitignored.

- [ ] **Step 4: Commit**

```bash
git add app/src/env.d.ts .env.example
git commit -m "feat(config): document VITE_* env vars and add ambient types"
```

---

## Task 4: Typed config accessor with tests

**Files:**
- Create: `app/src/lib/config.ts`
- Create: `app/src/lib/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/config.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(import.meta.env)) {
      if (key.startsWith('VITE_')) {
        // @ts-expect-error - test-only mutation
        delete import.meta.env[key];
      }
    }
    Object.assign(import.meta.env, originalEnv);
  });

  it('exposes all required values from import.meta.env', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test App',
      VITE_APP_DOMAIN: 'test.example',
      VITE_OPERATOR_HANDLE: 'op.example',
      VITE_BEACON_AT_URI: 'at://did:plc:abc/app.bsky.feed.post/xyz',
      VITE_DEFAULT_PDS: 'https://pds.example',
      VITE_HELPER_ORIGIN: 'http://127.0.0.1:7878',
      VITE_REPO_URL: 'https://github.com/example/repo',
      VITE_PYODIDE_VERSION: '0.26.4',
    });

    const { config } = await import('./config');

    expect(config.appName).toBe('Test App');
    expect(config.appDomain).toBe('test.example');
    expect(config.operatorHandle).toBe('op.example');
    expect(config.beaconAtUri).toBe('at://did:plc:abc/app.bsky.feed.post/xyz');
    expect(config.defaultPds).toBe('https://pds.example');
    expect(config.helperOrigin).toBe('http://127.0.0.1:7878');
    expect(config.repoUrl).toBe('https://github.com/example/repo');
    expect(config.pyodideVersion).toBe('0.26.4');
  });

  it('treats empty VITE_BEACON_AT_URI as null', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test',
      VITE_APP_DOMAIN: 'test',
      VITE_OPERATOR_HANDLE: 'op',
      VITE_BEACON_AT_URI: '',
      VITE_DEFAULT_PDS: 'https://x',
      VITE_HELPER_ORIGIN: 'http://x',
      VITE_REPO_URL: 'https://x',
      VITE_PYODIDE_VERSION: '0.0.0',
    });

    const { config } = await import('./config');

    expect(config.beaconAtUri).toBeNull();
  });

  it('throws on missing required values at module load time', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test',
      VITE_APP_DOMAIN: '',
      VITE_OPERATOR_HANDLE: 'op',
      VITE_BEACON_AT_URI: '',
      VITE_DEFAULT_PDS: 'https://x',
      VITE_HELPER_ORIGIN: 'http://x',
      VITE_REPO_URL: 'https://x',
      VITE_PYODIDE_VERSION: '0.0.0',
    });

    await expect(import('./config')).rejects.toThrow(/VITE_APP_DOMAIN/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm test app/src/lib/config.test.ts
```

Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Implement `app/src/lib/config.ts`**

Contents:
```ts
function required(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function optional(key: keyof ImportMetaEnv): string | null {
  const value = import.meta.env[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface Config {
  readonly appName: string;
  readonly appDomain: string;
  readonly operatorHandle: string;
  readonly beaconAtUri: string | null;
  readonly defaultPds: string;
  readonly helperOrigin: string;
  readonly repoUrl: string;
  readonly pyodideVersion: string;
}

export const config: Config = Object.freeze({
  appName: required('VITE_APP_NAME'),
  appDomain: required('VITE_APP_DOMAIN'),
  operatorHandle: required('VITE_OPERATOR_HANDLE'),
  beaconAtUri: optional('VITE_BEACON_AT_URI'),
  defaultPds: required('VITE_DEFAULT_PDS'),
  helperOrigin: required('VITE_HELPER_ORIGIN'),
  repoUrl: required('VITE_REPO_URL'),
  pyodideVersion: required('VITE_PYODIDE_VERSION'),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
pnpm test app/src/lib/config.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/config.ts app/src/lib/config.test.ts
git commit -m "feat(config): typed accessor for VITE_* env with required/optional handling"
```

---

## Task 5: Hash router (state + parser) with tests

The router for Plan 1 is intentionally simple: parse `window.location.hash` into a route, expose a Svelte store for it, navigate by setting the hash. Slide transitions and stack-aware animations are deferred to Plan 3 once the reader exists.

**Files:**
- Create: `app/src/lib/router.ts`
- Create: `app/src/lib/router.test.ts`
- Create: `app/src/lib/routes.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/router.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm test app/src/lib/router.test.ts
```

Expected: FAIL — `Cannot find module './router'`.

- [ ] **Step 3: Create the route table at `app/src/lib/routes.ts`**

Contents:
```ts
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
```

- [ ] **Step 4: Implement `app/src/lib/router.ts`**

Contents:
```ts
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
}

export function startRouter(): () => void {
  const handler = () => store.set(parsePath(readHash()));
  store.set(parsePath(readHash()));
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
```

- [ ] **Step 5: Create the placeholder route components**

Create `app/src/routes/SignIn.svelte`:
```svelte
<section class="route route--sign-in">
  <h2>Sign in</h2>
  <p>Sign-in form will be implemented in Plan 2.</p>
</section>
```

Create `app/src/routes/Library.svelte`:
```svelte
<section class="route route--library">
  <h2>Library</h2>
  <p>Reader will be implemented in Plan 3.</p>
</section>
```

Create `app/src/routes/Post.svelte`:
```svelte
<script lang="ts">
  import { currentRoute } from '$lib/router';
</script>

<section class="route route--post">
  <h2>Post</h2>
  <p>rkey: {$currentRoute.params.rkey ?? '(none)'}</p>
  <p>Focus view will be implemented in Plan 3.</p>
</section>
```

Create `app/src/routes/Settings.svelte`:
```svelte
<section class="route route--settings">
  <h2>Settings</h2>
  <p>Settings will be implemented in Plan 7.</p>
</section>
```

Create `app/src/routes/Privacy.svelte`:
```svelte
<section class="route route--privacy">
  <h2>Privacy</h2>
  <p>Privacy policy will be rendered here in Plan 7.</p>
</section>
```

Create `app/src/routes/NotFound.svelte`:
```svelte
<script lang="ts">
  import { navigate } from '$lib/router';
</script>

<section class="route route--not-found">
  <h2>Not found</h2>
  <p>That page doesn't exist.</p>
  <button type="button" on:click={() => navigate('/')}>Go home</button>
</section>
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
pnpm test app/src/lib/router.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/router.ts app/src/lib/router.test.ts app/src/lib/routes.ts app/src/routes/
git commit -m "feat(router): hash router with route table and placeholder routes"
```

---

## Task 6: Root layout — `App.svelte`, `main.ts`, `index.html`

**Files:**
- Create: `index.html`
- Create: `app/src/main.ts`
- Create: `app/src/App.svelte`
- Create: `app/public/.gitkeep`

- [ ] **Step 1: Create `app/index.html`**

Vite is configured with `root: 'app'`, so the entry HTML lives at
`app/index.html`. Create the file with these contents:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>%VITE_APP_NAME%</title>
    <meta name="description" content="Export your Bluesky saved posts. Runs entirely in your browser." />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Note: Vite resolves `%VITE_APP_NAME%` from `import.meta.env` at build time.

- [ ] **Step 2: Create `app/public/.gitkeep`** so the directory exists

```bash
mkdir -p app/public
touch app/public/.gitkeep
```

- [ ] **Step 3: Create `app/src/main.ts`**

Contents:
```ts
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Missing #app mount target in index.html');
}

new App({ target });
```

- [ ] **Step 4: Create `app/src/App.svelte`**

Contents:
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { config } from '$lib/config';
  import { currentRoute, startRouter, navigate } from '$lib/router';

  onMount(() => startRouter());
</script>

<div class="app">
  <header class="app-header">
    <button
      type="button"
      class="app-header__title"
      on:click={() => navigate('/')}
      aria-label="Go to sign-in"
    >
      {config.appName}
    </button>
    <nav class="app-header__nav">
      <a href="#/library">Library</a>
      <a href="#/settings">Settings</a>
      <a href="#/privacy">Privacy</a>
    </nav>
  </header>

  <main class="app-main">
    <svelte:component this={$currentRoute.def.component} />
  </main>

  <footer class="app-footer">
    <p>
      Operator: <code>@{config.operatorHandle}</code>
    </p>
    <p>
      <a href={config.repoUrl} target="_blank" rel="noopener noreferrer">Source</a>
      ·
      <a href="#/privacy">Privacy</a>
    </p>
  </footer>
</div>

<style>
  :global(html, body, #app) {
    height: 100%;
    margin: 0;
  }
  :global(body) {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: Canvas;
    color: CanvasText;
  }
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
  }
  .app-header__title {
    background: none;
    border: none;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    color: inherit;
  }
  .app-header__nav a {
    margin-left: 1rem;
  }
  .app-main {
    flex: 1;
    padding: 1.5rem;
  }
  .app-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
    font-size: 0.875rem;
    opacity: 0.85;
  }
  .app-footer p {
    margin: 0.25rem 0;
  }
</style>
```

- [ ] **Step 5: Run dev server and verify**

Run:
```bash
pnpm dev
```

Open the URL printed in the terminal (defaults to `http://localhost:5173`). Verify:
- The product name from `VITE_APP_NAME` shows in the header.
- Clicking nav links updates the URL hash and the page content.
- The footer shows operator handle and a link to the repo.
- The browser tab title shows the app name.

Stop the dev server with Ctrl-C.

- [ ] **Step 6: Run a production build to verify it compiles**

Run:
```bash
pnpm build
```

Expected: build completes, `dist/index.html` exists with `<title>BlueSky Saves Exporter</title>`.

- [ ] **Step 7: Commit**

```bash
git add app/index.html app/public/.gitkeep app/src/main.ts app/src/App.svelte
git commit -m "feat(app): root layout with header, routed main, and footer"
```

---

## Task 7: CNAME emission via Vite plugin

**Files:**
- Create: `tools/vite-plugin-cname.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write the plugin**

Create `tools/vite-plugin-cname.ts`:
```ts
import type { Plugin } from 'vite';

export interface CnamePluginOptions {
  readonly domain: string;
}

export function cnamePlugin(options: CnamePluginOptions): Plugin {
  return {
    name: 'cname',
    apply: 'build',
    generateBundle() {
      if (!options.domain || options.domain.length === 0) {
        this.warn('VITE_APP_DOMAIN is empty; skipping CNAME emission');
        return;
      }
      this.emitFile({
        type: 'asset',
        fileName: 'CNAME',
        source: `${options.domain}\n`,
      });
    },
  };
}
```

- [ ] **Step 2: Wire the plugin into `vite.config.ts`**

Replace the contents of `vite.config.ts` with:
```ts
import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';
import { cnamePlugin } from './tools/vite-plugin-cname';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const domain = env.VITE_APP_DOMAIN ?? '';

  return {
    root: 'app',
    publicDir: 'public',
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      sourcemap: true,
    },
    resolve: {
      alias: {
        $lib: fileURLToPath(new URL('./app/src/lib', import.meta.url)),
        $routes: fileURLToPath(new URL('./app/src/routes', import.meta.url)),
      },
    },
    plugins: [svelte(), cnamePlugin({ domain })],
  };
});
```

- [ ] **Step 3: Verify CNAME ends up in the build output**

Run:
```bash
pnpm build
cat dist/CNAME
```

Expected: prints `saves.lightseed.net` (or whatever `VITE_APP_DOMAIN` is set to in `.env`).

- [ ] **Step 4: Commit**

```bash
git add tools/vite-plugin-cname.ts vite.config.ts
git commit -m "feat(build): emit CNAME from VITE_APP_DOMAIN at build time"
```

---

## Task 8: Root README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

Contents:
```markdown
# BlueSky Saves Exporter

> _Working title — final product name TBD. The user-visible name is set by `VITE_APP_NAME` and can be changed without touching code._

A web GUI for [`bsky-saves`](https://github.com/tenorune/bsky-saves) that lets a Bluesky user export their saved posts as JSON, a flat Markdown file, or a self-contained HTML/CSS archive.

## What it does

- Exports your Bluesky saves as JSON, Markdown, or a navigable HTML archive.
- Runs entirely in your browser — there is no server that holds your credentials or content.
- Optional hydration of threads, articles, and images via [`bsky-saves`](https://github.com/tenorune/bsky-saves) running under [Pyodide](https://pyodide.org).

## Try it

The reference deployment lives at the domain configured for this build (see `VITE_APP_DOMAIN` in `.env.example`). The default is `saves.lightseed.net`.

## How it works

Static SPA. Pyodide loads the published `bsky-saves` Python package in your browser; AT Protocol requests go directly from your browser to your PDS. Inventory is stored locally in IndexedDB. Exports are generated and downloaded entirely client-side.

See the design spec: [`docs/superpowers/specs/2026-05-01-bsky-saves-gui-design.md`](docs/superpowers/specs/2026-05-01-bsky-saves-gui-design.md).

## Privacy

No analytics service. No telemetry. The deployer cannot see your credentials, your saves, or any post content. The only signal the deployer ever receives is an explicit "Tell @${operator} you used this" button click, which likes a single pinned beacon post on the operator's account.

Full details once Plan 7 lands: `docs/privacy.md`.

## Self-host / fork

1. Clone the repo.
2. `cp .env.example .env` and edit the `VITE_*` values for your deployment.
3. Push to GitHub. Configure GitHub Pages to deploy from GitHub Actions.
4. Set repository variables (Settings → Secrets and variables → Actions → Variables) for each `VITE_*` value the deploy workflow needs.
5. Add a DNS `CNAME` record at your domain provider pointing your chosen subdomain to `<your-username>.github.io`.

The full configuration table lives in the design spec: [Configuration section](docs/superpowers/specs/2026-05-01-bsky-saves-gui-design.md#configuration-deploy-agnostic).

## The helper

A separate Python package (`bsky-saves-gui-helper`, working name) handles article hydration. It runs locally on `127.0.0.1:7878` and lets the browser fetch arbitrary article URLs that would otherwise be blocked by CORS. To be implemented in Plan 5; see `helper/README.md` once available.

## The proxy template

A one-file Cloudflare Worker template at `templates/cf-worker/` provides the same capability without installing Python — the user deploys it to their own Cloudflare account. To be implemented in Plan 6; see `templates/cf-worker/README.md` once available.

## Development

Requires Node 20 and pnpm 9.

```bash
pnpm install
pnpm dev          # local dev server
pnpm test         # run unit tests
pnpm build        # production build to dist/
pnpm check        # svelte-check + tsc
pnpm format       # prettier
```

## Repo layout

```
.
├── app/                  # Svelte + Vite source
├── tools/                # build-time helpers (e.g. CNAME plugin)
├── helper/               # Python helper package (Plan 5)
├── templates/cf-worker/  # Cloudflare Worker template (Plan 6)
├── docs/
│   ├── superpowers/
│   │   ├── specs/        # design specs
│   │   └── plans/        # implementation plans
│   └── privacy.md        # (Plan 7)
└── .github/workflows/    # CI and deploy
```

## License

MIT — see [`LICENSE`](LICENSE).

## Status

Pre-1.0. Working title for the product is "BlueSky Saves Exporter"; a final brand name has not been chosen. The implementation rolls out across plans under `docs/superpowers/plans/`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add root README"
```

---

## Task 9: Build CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

Contents of `.github/workflows/ci.yml`:
```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm check

      - run: pnpm test

      - name: Build (using example env)
        run: |
          cp .env.example .env
          pnpm build

      - name: Confirm CNAME is in dist
        run: |
          test -f dist/CNAME
          cat dist/CNAME
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build and test workflow for PRs and main"
```

---

## Task 10: GitHub Pages deploy workflow

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Create the deploy workflow**

Contents of `.github/workflows/pages.yml`:
```yaml
name: pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build
        env:
          VITE_APP_NAME: ${{ vars.VITE_APP_NAME }}
          VITE_APP_DOMAIN: ${{ vars.VITE_APP_DOMAIN }}
          VITE_OPERATOR_HANDLE: ${{ vars.VITE_OPERATOR_HANDLE }}
          VITE_BEACON_AT_URI: ${{ vars.VITE_BEACON_AT_URI }}
          VITE_DEFAULT_PDS: ${{ vars.VITE_DEFAULT_PDS }}
          VITE_HELPER_ORIGIN: ${{ vars.VITE_HELPER_ORIGIN }}
          VITE_REPO_URL: ${{ vars.VITE_REPO_URL }}
          VITE_PYODIDE_VERSION: ${{ vars.VITE_PYODIDE_VERSION }}
        run: pnpm build

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Document the required GitHub repo configuration**

In `README.md`, the "Self-host / fork" section already documents the required steps. No code change.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy to GitHub Pages on push to main"
```

---

## Final verification

- [ ] **Step 1: Run the full test suite**

Run:
```bash
pnpm test
```

Expected: PASS — all tests across `config.test.ts` and `router.test.ts`.

- [ ] **Step 2: Run type check**

Run:
```bash
pnpm check
```

Expected: 0 errors.

- [ ] **Step 3: Run a clean build**

Run:
```bash
rm -rf dist
pnpm build
```

Expected: `dist/index.html`, `dist/CNAME`, `dist/assets/*` all present. `dist/CNAME` contains the value from `.env`.

- [ ] **Step 4: Smoke-test the built site**

Run:
```bash
pnpm preview
```

Open the URL printed. Verify:
- Header shows the app name from `VITE_APP_NAME`.
- Clicking each nav link routes to the right placeholder page (`Library`, `Settings`, `Privacy`).
- Visiting `#/post/abc` shows the post placeholder with `rkey: abc`.
- Visiting `#/totally-unknown` shows the not-found page.
- Footer shows operator handle and the repo link.

- [ ] **Step 5: Push to GitHub**

```bash
git push origin main
```

The `pages.yml` workflow runs. Once the GitHub Pages environment is configured (Settings → Pages → Source = GitHub Actions) and repository variables are set for each `VITE_*`, the live site at `${VITE_APP_DOMAIN}` will reflect the build.

- [ ] **Step 6: Final commit if anything changed during verification**

If steps 1–4 surfaced fixes:
```bash
git add -A
git commit -m "fix: address verification findings"
git push origin main
```

---

## Done criteria

After this plan, the following should all be true:

1. `pnpm install && pnpm test && pnpm build` succeeds on a fresh clone.
2. `dist/CNAME` contains the `VITE_APP_DOMAIN` value.
3. `dist/index.html` titles the page with `VITE_APP_NAME`.
4. The deployed app at `${VITE_APP_DOMAIN}` shows the header, footer, and nav with config-driven values.
5. Hash routes `#/`, `#/library`, `#/post/:rkey`, `#/settings`, `#/privacy` each render their placeholder component, and unknown routes render the not-found page.
6. The CI workflow runs on PRs and the deploy workflow runs on `main`.
7. The README documents what the product is, how to run it, and how to fork-and-self-host.

Plan 2 will replace the SignIn placeholder with a real form, load Pyodide, and produce an inventory in IndexedDB.
