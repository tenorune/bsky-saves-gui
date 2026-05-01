# Plan 2 — Engine: Sign-In + Pyodide + IndexedDB

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SignIn placeholder with a real form that authenticates against a Bluesky PDS, loads `bsky-saves` under Pyodide in the browser, runs a `fetch` (and optional `enrich`), persists the resulting inventory to IndexedDB, and routes to the library view (still a placeholder until Plan 3). Optional encrypted persistence for the app password is wired up as well.

**Architecture:** Browser-only. Sign-in performs an `app.bsky.server.createSession` request directly to the user's chosen PDS (light pre-flight). On success, Pyodide loads, `bsky-saves` is installed via `micropip`, and its `fetch` + `enrich` functions are invoked with the user's credentials passed in via Python's `os.environ`. The resulting `saves_inventory.json` is read back from Pyodide's virtual filesystem, parsed, and written into IndexedDB. A run log streams to a progress panel. WebCrypto-backed credential persistence is opt-in.

**Tech Stack:** Existing Svelte/Vite/TS stack. Adds `pyodide` (CDN-loaded; `VITE_PYODIDE_VERSION` controls version), `idb-keyval` for IndexedDB ergonomics, `fake-indexeddb` for tests. No `@atproto/api` SDK — raw `fetch` for the one XRPC call.

**Reference:** [Design spec](../specs/2026-05-01-bsky-saves-gui-design.md) — Engine, Privacy & security, User flow sections.

---

## File Structure

```
app/src/
├── lib/
│   ├── atproto.ts            # createSession against a PDS
│   ├── atproto.test.ts
│   ├── crypto.ts             # PBKDF2 + AES-GCM passphrase cipher
│   ├── crypto.test.ts
│   ├── inventory-store.ts    # IndexedDB CRUD for saves_inventory.json
│   ├── inventory-store.test.ts
│   ├── credentials-store.ts  # IndexedDB-backed encrypted credentials
│   ├── credentials-store.test.ts
│   ├── pyodide-runner.ts     # loads Pyodide and bsky-saves; exposes fetch/enrich
│   ├── pyodide-runner.test.ts
│   ├── engine.ts             # orchestrates a run (sign in → fetch → enrich → store)
│   └── engine.test.ts
└── routes/
    ├── SignIn.svelte         # real sign-in form (replaces placeholder)
    └── Run.svelte            # NEW: progress + log panel; mounted at #/run

app/src/lib/test-helpers/
└── fake-pyodide.ts           # in-memory mock of the pyodide API surface we use
```

A new route `#/run` is added to `app/src/lib/routes.ts`.

---

## Task 1: AT Proto session login client

**Files:**
- Create: `app/src/lib/atproto.ts`
- Create: `app/src/lib/atproto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/atproto.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

describe('atproto.createSession', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs identifier + password to com.atproto.server.createSession on the given PDS', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessJwt: 'jwt-a',
          refreshJwt: 'jwt-r',
          handle: 'alice.bsky.social',
          did: 'did:plc:abc',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { createSession } = await import('./atproto');
    const session = await createSession({
      pds: 'https://bsky.social',
      identifier: 'alice.bsky.social',
      password: 'app-pass-1234',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://bsky.social/xrpc/com.atproto.server.createSession',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: JSON.stringify({ identifier: 'alice.bsky.social', password: 'app-pass-1234' }),
      }),
    );
    expect(session).toEqual({
      accessJwt: 'jwt-a',
      refreshJwt: 'jwt-r',
      handle: 'alice.bsky.social',
      did: 'did:plc:abc',
    });
  });

  it('throws InvalidCredentialsError on 401', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'AuthenticationRequired' }), { status: 401 }),
    );

    const { createSession, InvalidCredentialsError } = await import('./atproto');
    await expect(
      createSession({ pds: 'https://bsky.social', identifier: 'a', password: 'b' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('throws PdsError on 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 503 }));

    const { createSession, PdsError } = await import('./atproto');
    await expect(
      createSession({ pds: 'https://bsky.social', identifier: 'a', password: 'b' }),
    ).rejects.toBeInstanceOf(PdsError);
  });

  it('strips trailing slash from pds', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ accessJwt: 'a', refreshJwt: 'r', handle: 'h', did: 'd' }),
        { status: 200 },
      ),
    );
    const { createSession } = await import('./atproto');
    await createSession({ pds: 'https://pds.example/', identifier: 'a', password: 'b' });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe('https://pds.example/xrpc/com.atproto.server.createSession');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test -- atproto`. Expected: `Cannot find module './atproto'`.

- [ ] **Step 3: Implement `app/src/lib/atproto.ts`**

```ts
export interface CreateSessionInput {
  readonly pds: string;
  readonly identifier: string;
  readonly password: string;
}

export interface AtSession {
  readonly accessJwt: string;
  readonly refreshJwt: string;
  readonly handle: string;
  readonly did: string;
}

export class InvalidCredentialsError extends Error {
  constructor(message = 'Invalid handle or app password') {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

export class PdsError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PdsError';
  }
}

export async function createSession(input: CreateSessionInput): Promise<AtSession> {
  const base = input.pds.replace(/\/+$/, '');
  const url = `${base}/xrpc/com.atproto.server.createSession`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: input.identifier, password: input.password }),
  });

  if (res.status === 401) throw new InvalidCredentialsError();
  if (!res.ok) throw new PdsError(res.status, `PDS returned ${res.status}`);

  const body = (await res.json()) as AtSession;
  return {
    accessJwt: body.accessJwt,
    refreshJwt: body.refreshJwt,
    handle: body.handle,
    did: body.did,
  };
}
```

- [ ] **Step 4: Run, expect pass**

`pnpm test -- atproto`. 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/atproto.ts app/src/lib/atproto.test.ts
git commit -m "feat(engine): AT Proto createSession client with typed errors"
```

---

## Task 2: WebCrypto passphrase cipher

**Files:**
- Create: `app/src/lib/crypto.ts`
- Create: `app/src/lib/crypto.test.ts`

This wraps PBKDF2-SHA256 (≥600,000 iterations) + AES-GCM. Used by `credentials-store` to encrypt the saved app password.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/crypto.test.ts
import { describe, expect, it } from 'vitest';

describe('crypto', () => {
  it('round-trips a plaintext through encrypt/decrypt with the same passphrase', async () => {
    const { encrypt, decrypt } = await import('./crypto');
    const ciphertext = await encrypt('hello world', 'correct horse battery staple');
    const plaintext = await decrypt(ciphertext, 'correct horse battery staple');
    expect(plaintext).toBe('hello world');
  });

  it('produces different ciphertext for the same plaintext+passphrase across calls', async () => {
    const { encrypt } = await import('./crypto');
    const a = await encrypt('hi', 'pass');
    const b = await encrypt('hi', 'pass');
    expect(a).not.toBe(b); // distinct salt + IV
  });

  it('throws on wrong passphrase', async () => {
    const { encrypt, decrypt, DecryptError } = await import('./crypto');
    const ciphertext = await encrypt('secret', 'right');
    await expect(decrypt(ciphertext, 'wrong')).rejects.toBeInstanceOf(DecryptError);
  });

  it('rejects malformed ciphertext', async () => {
    const { decrypt, DecryptError } = await import('./crypto');
    await expect(decrypt('not-base64-or-json', 'p')).rejects.toBeInstanceOf(DecryptError);
  });
});
```

- [ ] **Step 2: Run, fail.** Expected `Cannot find module`.

- [ ] **Step 3: Implement `app/src/lib/crypto.ts`**

```ts
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export class DecryptError extends Error {
  constructor(message = 'Decryption failed') {
    super(message);
    this.name = 'DecryptError';
  }
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encrypt(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  return JSON.stringify({
    v: 1,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ciphertext),
  });
}

export async function decrypt(envelope: string, passphrase: string): Promise<string> {
  let parsed: { v: number; salt: string; iv: string; ct: string };
  try {
    parsed = JSON.parse(envelope);
    if (parsed.v !== 1 || !parsed.salt || !parsed.iv || !parsed.ct) {
      throw new Error('bad envelope');
    }
  } catch {
    throw new DecryptError('Malformed ciphertext');
  }
  try {
    const salt = fromB64(parsed.salt);
    const iv = fromB64(parsed.iv);
    const ct = fromB64(parsed.ct);
    const key = await deriveKey(passphrase, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    throw new DecryptError();
  }
}
```

- [ ] **Step 4: Run, expect pass.** 4 tests pass.

Note: jsdom environment provides `crypto.subtle` via Node's webcrypto. If a test fails due to missing `crypto.subtle`, the implementer should add `import { webcrypto } from 'node:crypto'; vi.stubGlobal('crypto', webcrypto);` in a setup file. Try without first.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/crypto.ts app/src/lib/crypto.test.ts
git commit -m "feat(crypto): PBKDF2 + AES-GCM passphrase cipher"
```

---

## Task 3: Inventory store (IndexedDB)

**Files:**
- Create: `app/src/lib/inventory-store.ts`
- Create: `app/src/lib/inventory-store.test.ts`
- Modify: `package.json` (add `idb-keyval` and `fake-indexeddb` to deps)

- [ ] **Step 1: Add dependencies**

```bash
pnpm add idb-keyval
pnpm add -D fake-indexeddb
```

- [ ] **Step 2: Write the failing test**

```ts
// app/src/lib/inventory-store.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('inventoryStore', () => {
  beforeEach(async () => {
    const { clearInventory } = await import('./inventory-store');
    await clearInventory();
  });

  it('returns null when no inventory has been saved', async () => {
    const { loadInventory } = await import('./inventory-store');
    expect(await loadInventory()).toBeNull();
  });

  it('round-trips a saved inventory', async () => {
    const { saveInventory, loadInventory } = await import('./inventory-store');
    const sample = { saves: [{ uri: 'at://x', text: 'hi' }], version: 1 };
    await saveInventory(sample);
    expect(await loadInventory()).toEqual(sample);
  });

  it('overwrites previous inventory on save', async () => {
    const { saveInventory, loadInventory } = await import('./inventory-store');
    await saveInventory({ saves: [{ uri: 'a' }] });
    await saveInventory({ saves: [{ uri: 'b' }] });
    const got = await loadInventory();
    expect(got).toEqual({ saves: [{ uri: 'b' }] });
  });

  it('clearInventory wipes the entry', async () => {
    const { saveInventory, loadInventory, clearInventory } = await import('./inventory-store');
    await saveInventory({ saves: [{ uri: 'a' }] });
    await clearInventory();
    expect(await loadInventory()).toBeNull();
  });
});
```

- [ ] **Step 3: Run, fail.**

- [ ] **Step 4: Implement `app/src/lib/inventory-store.ts`**

```ts
import { get, set, del } from 'idb-keyval';

const KEY = 'inventory:v1';

export type Inventory = unknown; // shape comes from bsky-saves; treated opaquely here

export async function saveInventory(inventory: Inventory): Promise<void> {
  await set(KEY, inventory);
}

export async function loadInventory(): Promise<Inventory | null> {
  const v = await get(KEY);
  return v === undefined ? null : v;
}

export async function clearInventory(): Promise<void> {
  await del(KEY);
}
```

- [ ] **Step 5: Run, expect pass.** 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/inventory-store.ts app/src/lib/inventory-store.test.ts package.json pnpm-lock.yaml
git commit -m "feat(store): IndexedDB inventory CRUD with idb-keyval"
```

---

## Task 4: Credentials store (encrypted, IndexedDB)

**Files:**
- Create: `app/src/lib/credentials-store.ts`
- Create: `app/src/lib/credentials-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/credentials-store.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

describe('credentialsStore', () => {
  beforeEach(async () => {
    const { clearCredentials } = await import('./credentials-store');
    await clearCredentials();
  });

  it('returns null when nothing is stored', async () => {
    const { loadCredentials } = await import('./credentials-store');
    expect(await loadCredentials('any-pass')).toBeNull();
  });

  it('round-trips credentials with the same passphrase', async () => {
    const { saveCredentials, loadCredentials } = await import('./credentials-store');
    await saveCredentials(
      { handle: 'alice.bsky.social', appPassword: 'pwd-1234', pds: 'https://bsky.social' },
      'right',
    );
    const got = await loadCredentials('right');
    expect(got).toEqual({
      handle: 'alice.bsky.social',
      appPassword: 'pwd-1234',
      pds: 'https://bsky.social',
    });
  });

  it('throws DecryptError on wrong passphrase', async () => {
    const { saveCredentials, loadCredentials } = await import('./credentials-store');
    const { DecryptError } = await import('./crypto');
    await saveCredentials({ handle: 'a', appPassword: 'b', pds: 'https://x' }, 'right');
    await expect(loadCredentials('wrong')).rejects.toBeInstanceOf(DecryptError);
  });

  it('hasCredentials returns true after save and false after clear', async () => {
    const { saveCredentials, hasCredentials, clearCredentials } = await import(
      './credentials-store'
    );
    expect(await hasCredentials()).toBe(false);
    await saveCredentials({ handle: 'a', appPassword: 'b', pds: 'https://x' }, 'p');
    expect(await hasCredentials()).toBe(true);
    await clearCredentials();
    expect(await hasCredentials()).toBe(false);
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement `app/src/lib/credentials-store.ts`**

```ts
import { get, set, del } from 'idb-keyval';
import { encrypt, decrypt } from './crypto';

const KEY = 'credentials:v1';

export interface Credentials {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
}

export async function saveCredentials(creds: Credentials, passphrase: string): Promise<void> {
  const envelope = await encrypt(JSON.stringify(creds), passphrase);
  await set(KEY, envelope);
}

export async function loadCredentials(passphrase: string): Promise<Credentials | null> {
  const envelope = (await get(KEY)) as string | undefined;
  if (!envelope) return null;
  const json = await decrypt(envelope, passphrase);
  return JSON.parse(json) as Credentials;
}

export async function hasCredentials(): Promise<boolean> {
  const envelope = await get(KEY);
  return envelope !== undefined;
}

export async function clearCredentials(): Promise<void> {
  await del(KEY);
}
```

- [ ] **Step 4: Run, expect pass.** 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/credentials-store.ts app/src/lib/credentials-store.test.ts
git commit -m "feat(store): encrypted credentials store"
```

---

## Task 5: Pyodide runner

**Files:**
- Create: `app/src/lib/pyodide-runner.ts`
- Create: `app/src/lib/pyodide-runner.test.ts`
- Create: `app/src/lib/test-helpers/fake-pyodide.ts`

**Important:** Pyodide itself is too heavy to load in tests. The runner must accept a "loader" function so tests can inject a fake. Real loader uses `import()` of the Pyodide CDN URL pinned by `VITE_PYODIDE_VERSION`.

- [ ] **Step 1: Investigate `bsky-saves` Python entry points (research, no code)**

Open https://github.com/tenorune/bsky-saves and confirm the public Python API for `fetch` and `enrich`. The CLI uses `argparse` over a single `main()` entry, which dispatches to subcommands. Goals:

- Find the Python module path that provides programmatic `fetch` and `enrich`.
- Confirm the inventory file location (default `saves_inventory.json` in `os.getcwd()`).
- Confirm credential env vars (`BSKY_HANDLE`, `BSKY_APP_PASSWORD`, optional `BSKY_PDS`).

Document findings in a short comment at the top of `pyodide-runner.ts`. If the API is not stably callable, the runner should call `bsky_saves.cli.main(["fetch"])` (or equivalent) directly.

- [ ] **Step 2: Define `fake-pyodide.ts`**

```ts
// app/src/lib/test-helpers/fake-pyodide.ts
export interface FakePyodideOptions {
  readonly fileSystem?: Record<string, string>;
  readonly onRunPython?: (code: string) => void;
}

export interface FakePyodide {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackage(names: string | string[]): Promise<void>;
  FS: {
    readFile(path: string, opts?: { encoding?: string }): string;
    writeFile(path: string, data: string): void;
  };
  globals: { set(name: string, value: unknown): void; get(name: string): unknown };
}

export function makeFakePyodide(opts: FakePyodideOptions = {}): FakePyodide {
  const fs: Record<string, string> = { ...opts.fileSystem };
  const globals = new Map<string, unknown>();
  return {
    async runPythonAsync(code: string) {
      opts.onRunPython?.(code);
      return undefined;
    },
    async loadPackage() {},
    FS: {
      readFile(path, { encoding } = {}) {
        const v = fs[path];
        if (v === undefined) throw new Error(`ENOENT: ${path}`);
        return encoding === 'utf8' ? v : v;
      },
      writeFile(path, data) {
        fs[path] = data;
      },
    },
    globals: {
      set: (k, v) => globals.set(k, v),
      get: (k) => globals.get(k),
    },
  };
}
```

- [ ] **Step 3: Write the failing test**

```ts
// app/src/lib/pyodide-runner.test.ts
import { describe, expect, it, vi } from 'vitest';
import { makeFakePyodide } from './test-helpers/fake-pyodide';

describe('pyodideRunner', () => {
  it('initialises the runtime, installs bsky-saves, and runs fetch with credentials in env', async () => {
    const ranCode: string[] = [];
    const fake = makeFakePyodide({
      fileSystem: {
        '/home/pyodide/saves_inventory.json': JSON.stringify({ saves: [{ uri: 'a' }] }),
      },
      onRunPython: (c) => ranCode.push(c),
    });
    const loader = vi.fn().mockResolvedValue(fake);

    const { PyodideRunner } = await import('./pyodide-runner');
    const runner = new PyodideRunner({ loader });
    await runner.initialise();
    const inventory = await runner.runFetch({
      handle: 'alice.bsky.social',
      appPassword: 'pw',
      pds: 'https://bsky.social',
      enrich: true,
    });

    expect(loader).toHaveBeenCalled();
    // Confirms env vars were set in Python
    expect(ranCode.some((c) => c.includes("os.environ['BSKY_HANDLE']"))).toBe(true);
    expect(ranCode.some((c) => c.includes("os.environ['BSKY_APP_PASSWORD']"))).toBe(true);
    expect(ranCode.some((c) => c.includes("os.environ['BSKY_PDS']"))).toBe(true);
    // Confirms bsky-saves install + fetch + enrich invocations
    expect(ranCode.some((c) => c.includes('micropip.install'))).toBe(true);
    expect(ranCode.some((c) => c.includes('bsky_saves'))).toBe(true);
    // Inventory parsed from FS
    expect(inventory).toEqual({ saves: [{ uri: 'a' }] });
  });

  it('emits log events as the run progresses', async () => {
    const fake = makeFakePyodide({
      fileSystem: {
        '/home/pyodide/saves_inventory.json': JSON.stringify({ saves: [] }),
      },
    });
    const { PyodideRunner } = await import('./pyodide-runner');
    const runner = new PyodideRunner({ loader: async () => fake });
    const events: string[] = [];
    runner.onLog((e) => events.push(e));
    await runner.initialise();
    await runner.runFetch({
      handle: 'a',
      appPassword: 'b',
      pds: 'https://x',
      enrich: false,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => /loading|installing|fetching|done/i.test(e))).toBe(true);
  });
});
```

- [ ] **Step 4: Run, fail.**

- [ ] **Step 5: Implement `app/src/lib/pyodide-runner.ts`**

```ts
import type { FakePyodide } from './test-helpers/fake-pyodide';
import { config } from './config';

export interface PyodideLike {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackage(names: string | string[]): Promise<void>;
  FS: {
    readFile(path: string, opts?: { encoding?: string }): string;
    writeFile(path: string, data: string): void;
  };
  globals: { set(name: string, value: unknown): void; get(name: string): unknown };
}

export interface FetchInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly enrich: boolean;
}

type LogListener = (message: string) => void;

const INVENTORY_PATH = '/home/pyodide/saves_inventory.json';

export interface PyodideRunnerOptions {
  readonly loader?: () => Promise<PyodideLike>;
}

async function defaultLoader(): Promise<PyodideLike> {
  const url = `https://cdn.jsdelivr.net/pyodide/v${config.pyodideVersion}/full/pyodide.mjs`;
  const mod: { loadPyodide: (opts?: unknown) => Promise<PyodideLike> } = await import(
    /* @vite-ignore */ url
  );
  return mod.loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${config.pyodideVersion}/full/`,
  });
}

export class PyodideRunner {
  private py: PyodideLike | null = null;
  private logListeners: LogListener[] = [];
  private readonly loader: () => Promise<PyodideLike>;

  constructor(options: PyodideRunnerOptions = {}) {
    this.loader = options.loader ?? defaultLoader;
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.push(listener);
    return () => {
      this.logListeners = this.logListeners.filter((l) => l !== listener);
    };
  }

  private log(message: string): void {
    for (const l of this.logListeners) l(message);
  }

  async initialise(): Promise<void> {
    if (this.py) return;
    this.log('Loading Pyodide…');
    this.py = await this.loader();
    this.log('Installing bsky-saves…');
    await this.py.loadPackage('micropip');
    await this.py.runPythonAsync(`
import micropip
await micropip.install('bsky-saves')
import os
os.makedirs('/home/pyodide', exist_ok=True)
os.chdir('/home/pyodide')
`);
  }

  async runFetch(input: FetchInput): Promise<unknown> {
    if (!this.py) throw new Error('Runner not initialised');

    this.log('Fetching saves…');
    // Set credentials via env vars; bsky-saves reads them from os.environ.
    await this.py.runPythonAsync(`
import os
os.environ['BSKY_HANDLE'] = ${JSON.stringify(input.handle)}
os.environ['BSKY_APP_PASSWORD'] = ${JSON.stringify(input.appPassword)}
os.environ['BSKY_PDS'] = ${JSON.stringify(input.pds)}
`);

    // Invoke bsky-saves' programmatic entry. The exact function name is
    // confirmed in Step 1 of this task and may need adjustment.
    await this.py.runPythonAsync(`
import bsky_saves
bsky_saves.cli.main(['fetch'])
`);

    if (input.enrich) {
      this.log('Enriching…');
      await this.py.runPythonAsync(`
import bsky_saves
bsky_saves.cli.main(['enrich'])
`);
    }

    this.log('Reading inventory…');
    const raw = this.py.FS.readFile(INVENTORY_PATH, { encoding: 'utf8' });
    this.log('Done.');
    return JSON.parse(raw);
  }
}

// Re-export for tests; the loader-injection pattern means callers can pass any
// PyodideLike. The fake from test-helpers/fake-pyodide.ts implements this.
export type { FakePyodide };
```

- [ ] **Step 6: Run tests, expect pass.** 2 tests pass.

If the bsky-saves entry-point investigation in Step 1 found a different module path (e.g., `bsky_saves.fetch:run()` rather than `bsky_saves.cli.main(['fetch'])`), update the Python snippets accordingly. Tests don't depend on the exact module path — they only check that `bsky_saves` is referenced in the executed code.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/pyodide-runner.ts app/src/lib/pyodide-runner.test.ts app/src/lib/test-helpers/
git commit -m "feat(engine): Pyodide runner with bsky-saves install and fetch invocation"
```

---

## Task 6: Engine orchestrator

**Files:**
- Create: `app/src/lib/engine.ts`
- Create: `app/src/lib/engine.test.ts`

The engine ties together: AT Proto pre-flight login, Pyodide runner, inventory store. Single async function `runJob(input, deps)` consumed by the UI.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/engine.test.ts
import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

describe('runJob', () => {
  it('signs in, runs Pyodide fetch, persists inventory, returns it', async () => {
    const session = { accessJwt: 'a', refreshJwt: 'r', handle: 'h', did: 'd' };
    const inventory = { saves: [{ uri: 'x' }] };

    const createSession = vi.fn().mockResolvedValue(session);
    const initialise = vi.fn().mockResolvedValue(undefined);
    const runFetch = vi.fn().mockResolvedValue(inventory);
    const onLog = vi.fn();

    const fakeRunner = {
      initialise,
      runFetch,
      onLog: () => () => {},
    };

    const { runJob } = await import('./engine');
    const { loadInventory } = await import('./inventory-store');

    const result = await runJob(
      {
        handle: 'alice.bsky.social',
        appPassword: 'pw',
        pds: 'https://bsky.social',
        enrich: true,
      },
      { createSession, runner: fakeRunner, onLog },
    );

    expect(createSession).toHaveBeenCalledWith({
      pds: 'https://bsky.social',
      identifier: 'alice.bsky.social',
      password: 'pw',
    });
    expect(initialise).toHaveBeenCalled();
    expect(runFetch).toHaveBeenCalledWith({
      handle: 'alice.bsky.social',
      appPassword: 'pw',
      pds: 'https://bsky.social',
      enrich: true,
    });
    expect(result.session).toEqual(session);
    expect(result.inventory).toEqual(inventory);
    expect(await loadInventory()).toEqual(inventory);
  });

  it('does not initialise Pyodide if sign-in fails', async () => {
    const { InvalidCredentialsError } = await import('./atproto');
    const createSession = vi.fn().mockRejectedValue(new InvalidCredentialsError());
    const initialise = vi.fn();
    const runFetch = vi.fn();

    const { runJob } = await import('./engine');
    await expect(
      runJob(
        { handle: 'a', appPassword: 'b', pds: 'https://x', enrich: false },
        {
          createSession,
          runner: { initialise, runFetch, onLog: () => () => {} },
          onLog: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(initialise).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement `app/src/lib/engine.ts`**

```ts
import { createSession as defaultCreateSession, type AtSession } from './atproto';
import { PyodideRunner } from './pyodide-runner';
import { saveInventory } from './inventory-store';

export interface RunJobInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly enrich: boolean;
}

interface RunnerLike {
  initialise(): Promise<void>;
  runFetch(input: RunJobInput): Promise<unknown>;
  onLog(listener: (msg: string) => void): () => void;
}

export interface RunJobDeps {
  readonly createSession?: typeof defaultCreateSession;
  readonly runner?: RunnerLike;
  readonly onLog?: (msg: string) => void;
}

export interface RunJobResult {
  readonly session: AtSession;
  readonly inventory: unknown;
}

export async function runJob(input: RunJobInput, deps: RunJobDeps = {}): Promise<RunJobResult> {
  const createSession = deps.createSession ?? defaultCreateSession;
  const runner = deps.runner ?? new PyodideRunner();
  const log = deps.onLog ?? (() => {});

  log('Signing in…');
  const session = await createSession({
    pds: input.pds,
    identifier: input.handle,
    password: input.appPassword,
  });
  log(`Signed in as @${session.handle}.`);

  const off = runner.onLog(log);
  try {
    await runner.initialise();
    const inventory = await runner.runFetch(input);
    await saveInventory(inventory);
    log('Inventory saved.');
    return { session, inventory };
  } finally {
    off();
  }
}
```

- [ ] **Step 4: Run, expect pass.** 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/engine.ts app/src/lib/engine.test.ts
git commit -m "feat(engine): orchestrator that signs in, runs fetch, persists inventory"
```

---

## Task 7: Add `#/run` route and update routes table

**Files:**
- Create: `app/src/routes/Run.svelte` (placeholder for now; Task 9 fills it)
- Modify: `app/src/lib/routes.ts` (add Run route)
- Modify: `app/src/lib/router.test.ts` (add a run-route test)

- [ ] **Step 1: Create stub `app/src/routes/Run.svelte`**

```svelte
<script lang="ts"></script>

<section class="route route--run">
  <h2>Run</h2>
  <p>Engine output appears here.</p>
</section>
```

- [ ] **Step 2: Add route entry**

In `app/src/lib/routes.ts`, import `Run` and insert into the `routes` array between `library` and `post`:

```ts
import Run from '$routes/Run.svelte';

// in the routes array:
{ name: 'run', pattern: /^\/run$/, paramNames: [], component: Run },
```

- [ ] **Step 3: Add a router test for the run route**

In `app/src/lib/router.test.ts`, append:

```ts
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
```

- [ ] **Step 4: Run tests, expect pass.** 8 router tests + others.

- [ ] **Step 5: Commit**

```bash
git add app/src/routes/Run.svelte app/src/lib/routes.ts app/src/lib/router.test.ts
git commit -m "feat(router): add #/run route with stub"
```

---

## Task 8: Real `SignIn.svelte` form

**Files:**
- Modify: `app/src/routes/SignIn.svelte` (replace placeholder with real form)

The form collects handle, app password, optional PDS override, optional "remember me" with passphrase. On submit, navigates to `#/run` with the inputs in a Svelte store (next task wires it up).

For now, focus on the form: validation, the help text per the design spec, the layout. Wire submission to a temporary inline `console.log`. Task 9 connects it to `runJob`.

- [ ] **Step 1: Implement the form**

Replace the contents of `app/src/routes/SignIn.svelte` with:

```svelte
<script lang="ts">
  import { config } from '$lib/config';
  import { navigate } from '$lib/router';
  import { signInDraft } from '$lib/sign-in-draft';

  let handle = '';
  let appPassword = '';
  let pds = config.defaultPds;
  let saveInventory = true;
  let saveCredentials = false;
  let passphrase = '';
  let enrich = true;
  let error = '';

  function submit() {
    error = '';
    if (!handle) {
      error = 'Handle is required.';
      return;
    }
    if (!appPassword) {
      error = 'App password is required.';
      return;
    }
    if (saveCredentials && passphrase.length < 8) {
      error = 'Passphrase must be at least 8 characters to save credentials.';
      return;
    }
    signInDraft.set({
      handle,
      appPassword,
      pds,
      enrich,
      saveInventory,
      saveCredentials,
      passphrase,
    });
    navigate('/run');
  }
</script>

<section class="route route--sign-in">
  <h2>Sign in to Bluesky</h2>

  <p class="help">
    Your handle and app password are sent only to your Bluesky server.
    Nothing is uploaded to <code>{config.appDomain}</code>; the page is static.
  </p>

  <form on:submit|preventDefault={submit}>
    <label>
      Handle
      <input
        type="text"
        autocomplete="username"
        placeholder="alice.bsky.social"
        bind:value={handle}
        required
      />
    </label>

    <label>
      App password
      <input type="password" autocomplete="current-password" bind:value={appPassword} required />
    </label>
    <p class="help">
      Use a Bluesky <strong>app password</strong>, not your main password — see Settings → App
      Passwords on the Bluesky web app.
    </p>

    <details>
      <summary>Advanced</summary>

      <label>
        PDS
        <input type="url" bind:value={pds} />
      </label>
      <p class="help">Defaults to Bluesky's main PDS. Change for third-party AT Proto servers.</p>

      <label>
        <input type="checkbox" bind:checked={enrich} />
        Enrich (decode timestamps)
      </label>
      <p class="help">On by default. Adds derived timestamps from the post metadata.</p>

      <label>
        <input type="checkbox" bind:checked={saveInventory} />
        Save inventory on this device
      </label>
      <p class="help">
        So you can come back and read or re-sync without re-fetching everything. Stored in this
        browser's IndexedDB.
      </p>

      <label>
        <input type="checkbox" bind:checked={saveCredentials} />
        Save app password on this device (encrypted)
      </label>
      {#if saveCredentials}
        <label>
          Passphrase
          <input type="password" bind:value={passphrase} minlength="8" />
        </label>
        <p class="help">
          Encrypts your app password with this passphrase. Only this browser, on this device, can
          read it. Forget the passphrase = re-enter the app password.
        </p>
      {/if}
    </details>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <button type="submit">Sign in</button>
  </form>
</section>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 32rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-weight: 500;
  }
  label input[type='checkbox'] {
    margin-right: 0.5rem;
  }
  .help {
    font-size: 0.875rem;
    opacity: 0.8;
    margin: 0;
  }
  .error {
    color: color-mix(in oklab, red 70%, CanvasText);
    font-weight: 500;
  }
  details summary {
    cursor: pointer;
    margin: 0.5rem 0;
  }
  button[type='submit'] {
    align-self: flex-start;
    padding: 0.5rem 1rem;
    font: inherit;
    cursor: pointer;
  }
</style>
```

- [ ] **Step 2: Create the draft store at `app/src/lib/sign-in-draft.ts`**

```ts
import { writable } from 'svelte/store';

export interface SignInDraft {
  handle: string;
  appPassword: string;
  pds: string;
  enrich: boolean;
  saveInventory: boolean;
  saveCredentials: boolean;
  passphrase: string;
}

export const signInDraft = writable<SignInDraft | null>(null);
```

- [ ] **Step 3: Run pnpm check + pnpm test**

`pnpm check` should be 0 errors. Tests should still pass (no new tests added for the form here).

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/SignIn.svelte app/src/lib/sign-in-draft.ts
git commit -m "feat(signin): real form with help text and advanced options"
```

---

## Task 9: Wire `Run.svelte` to the engine

**Files:**
- Modify: `app/src/routes/Run.svelte`

The Run route reads the draft from `signInDraft`, kicks off `runJob`, streams log lines into a panel, handles errors, and on success navigates to `#/library` (still a placeholder until Plan 3, but the navigation works). Honors the optional "save credentials" decision.

- [ ] **Step 1: Implement Run.svelte**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { signInDraft } from '$lib/sign-in-draft';
  import { navigate } from '$lib/router';
  import { runJob } from '$lib/engine';
  import { saveCredentials } from '$lib/credentials-store';
  import { InvalidCredentialsError, PdsError } from '$lib/atproto';

  let logLines: string[] = [];
  let status: 'idle' | 'running' | 'done' | 'error' = 'idle';
  let errorMessage = '';

  function appendLog(line: string) {
    logLines = [...logLines, line];
  }

  async function start() {
    const draft = get(signInDraft);
    if (!draft) {
      navigate('/');
      return;
    }
    status = 'running';
    appendLog('Starting…');
    try {
      await runJob(
        {
          handle: draft.handle,
          appPassword: draft.appPassword,
          pds: draft.pds,
          enrich: draft.enrich,
        },
        { onLog: appendLog },
      );
      if (draft.saveCredentials && draft.passphrase) {
        await saveCredentials(
          { handle: draft.handle, appPassword: draft.appPassword, pds: draft.pds },
          draft.passphrase,
        );
        appendLog('Credentials saved (encrypted).');
      }
      status = 'done';
      appendLog('Done. Opening library…');
      navigate('/library');
    } catch (e) {
      status = 'error';
      if (e instanceof InvalidCredentialsError) {
        errorMessage = 'Invalid handle or app password.';
      } else if (e instanceof PdsError) {
        errorMessage = `PDS error (${e.status}). Try again or check the PDS URL.`;
      } else {
        errorMessage = e instanceof Error ? e.message : String(e);
      }
      appendLog(`Failed: ${errorMessage}`);
    }
  }

  onMount(() => {
    void start();
  });
</script>

<section class="route route--run">
  <h2>Running</h2>

  <p class="status status--{status}">
    {#if status === 'running'}
      Working…
    {:else if status === 'done'}
      Done.
    {:else if status === 'error'}
      Error.
    {/if}
  </p>

  <pre class="log" aria-live="polite">{logLines.join('\n')}</pre>

  {#if status === 'error'}
    <button type="button" on:click={() => navigate('/')}>Back to sign-in</button>
  {/if}
</section>

<style>
  .log {
    background: color-mix(in oklab, CanvasText 5%, Canvas);
    padding: 1rem;
    overflow: auto;
    max-height: 60vh;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.875rem;
    border-radius: 6px;
    white-space: pre-wrap;
  }
  .status {
    font-weight: 500;
  }
  button {
    padding: 0.5rem 1rem;
    font: inherit;
    cursor: pointer;
  }
</style>
```

- [ ] **Step 2: pnpm check + pnpm test + pnpm build**

All should pass. Build emits a working `dist/` with the new code.

- [ ] **Step 3: Manual smoke test**

```bash
pnpm dev
```

Open the URL, navigate to the sign-in page, enter dummy values, click Sign in. The Run page renders. The actual Pyodide load + bsky-saves execution may fail in dev because Pyodide is loaded from CDN at runtime — that's expected and OK at this stage. Verify:
- The form validates required fields.
- Submitting routes to `#/run`.
- The Run page shows "Working…" and at least one log line.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/Run.svelte
git commit -m "feat(run): wire run page to engine.runJob with progress and error handling"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

```bash
pnpm test
```

Expected: ~25 tests pass across atproto, crypto, inventory-store, credentials-store, pyodide-runner, engine, router, config.

- [ ] **Step 2: Type check**

```bash
pnpm check
```

Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
pnpm build
```

Expected: success. `dist/` populated; `dist/CNAME` still present.

- [ ] **Step 4: Manual end-to-end (optional, requires real Bluesky test account)**

```bash
pnpm dev
```

With real handle + app password against `https://bsky.social`:
- Sign in succeeds.
- Pyodide loads (slow first time — ~10 seconds).
- `bsky-saves` installs via micropip.
- Fetch runs and produces an inventory.
- IndexedDB has an `inventory:v1` entry.
- Navigation lands on `#/library` (still placeholder).

If the bsky-saves Python entry-point in Task 5 needs adjustment, this is when it surfaces. Adjust and re-test.

- [ ] **Step 5: Push**

```bash
git push origin main
```

The deploy workflow runs and updates `saves.lightseed.net`.

---

## Done criteria

After Plan 2:

1. The sign-in page is a real form with validation and inline help text.
2. Submitting the form authenticates against the chosen PDS.
3. On success, Pyodide loads `bsky-saves`, runs `fetch` (and `enrich` if checked), and writes the inventory to IndexedDB.
4. A run-page shows live progress and surfaces errors clearly.
5. Optional encrypted persistence of the app password works (`hasCredentials() === true` after a "remember me" sign-in).
6. All unit tests pass; type check is clean.
7. Manual end-to-end against a real Bluesky test account produces a real inventory.

Plan 3 will replace the Library placeholder with a real reader that uses this inventory.
