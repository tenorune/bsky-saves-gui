// app/src/lib/pyodide-runner.ts
//
// bsky-saves entry point findings (2026-05-01):
//   - Package: bsky_saves (pip: bsky-saves)
//   - Programmatic fetch: bsky_saves.fetch.fetch_to_inventory(Path, handle=, app_password=, pds_base=)
//   - Programmatic enrich: bsky_saves.enrich.enrich_inventory(Path)
//   - Inventory file: saves_inventory.json in cwd (default /home/pyodide)
//   - Env vars: BSKY_HANDLE, BSKY_APP_PASSWORD, BSKY_PDS (optional; defaults to https://bsky.social)
//   - cli.main() wraps return codes in sys.exit() — avoid it in Pyodide; use the module APIs directly.

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
    this.log('Installing native packages…');
    // bsky-saves' top-level deps are httpx (pure Python) and trafilatura.
    // trafilatura's transitive tree (htmldate, dateparser, charset-normalizer,
    // lxml, regex, ...) is full of C/mypyc-compiled wheels that Pyodide's
    // micropip can only resolve via its own pre-built packages — and even
    // with lxml/regex/charset-normalizer preloaded, dateparser still fails
    // to resolve cleanly. trafilatura is only used for article hydration,
    // which this app routes through a local helper or Cloudflare Worker
    // anyway (browser CORS makes direct article fetches impossible). So we
    // install bsky-saves WITHOUT its deps and pull in only what fetch+enrich
    // actually need (httpx). Article-hydration code paths in bsky-saves will
    // raise ImportError if invoked, but the app doesn't invoke them yet.
    // `ssl` is unvendored from Pyodide's Python stdlib; httpcore imports it
    // unconditionally so we have to load it explicitly.
    await this.py.loadPackage(['micropip', 'ssl']);
    this.log('Installing bsky-saves…');
    await this.py.runPythonAsync(`
import micropip
await micropip.install('pyodide-http')
import pyodide_http
pyodide_http.patch_all()
await micropip.install('httpx')
await micropip.install('bsky-saves', deps=False)
import os
os.makedirs('/home/pyodide', exist_ok=True)
os.chdir('/home/pyodide')
`);
  }

  async runFetch(input: FetchInput): Promise<unknown> {
    if (!this.py) throw new Error('Runner not initialised');

    this.log('Fetching saves…');
    // Set credentials via env vars; bsky_saves.fetch.fetch_to_inventory reads them from os.environ.
    await this.py.runPythonAsync(`
import os
os.environ['BSKY_HANDLE'] = ${JSON.stringify(input.handle)}
os.environ['BSKY_APP_PASSWORD'] = ${JSON.stringify(input.appPassword)}
os.environ['BSKY_PDS'] = ${JSON.stringify(input.pds)}
`);

    // Use the programmatic API (fetch_to_inventory) instead of cli.main() because
    // cli.main() calls sys.exit() which terminates the Pyodide runtime.
    await this.py.runPythonAsync(`
from pathlib import Path
import bsky_saves.fetch as _bsky_fetch
import os
_bsky_fetch.fetch_to_inventory(
    Path('${INVENTORY_PATH}'),
    handle=os.environ['BSKY_HANDLE'],
    app_password=os.environ['BSKY_APP_PASSWORD'],
    pds_base=os.environ['BSKY_PDS'],
)
`);

    if (input.enrich) {
      this.log('Enriching…');
      await this.py.runPythonAsync(`
from pathlib import Path
import bsky_saves.enrich as _bsky_enrich
_bsky_enrich.enrich_inventory(Path('${INVENTORY_PATH}'))
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
