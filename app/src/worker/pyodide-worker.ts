/// <reference lib="webworker" />

// Pyodide runs in this Web Worker, isolated from the main thread.
// Sync XHR and other blocking operations work freely here without UI jank,
// and without the cross-origin sync-XHR restrictions browsers apply on the
// main thread.

interface PreauthSession {
  readonly accessJwt: string;
  readonly refreshJwt: string;
  readonly did: string;
  readonly handle: string;
}

interface FetchInput {
  readonly handle: string;
  readonly appPassword: string;
  readonly pds: string;
  readonly enrich: boolean;
  readonly threads: boolean;
  readonly preauthSession?: PreauthSession;
}

interface InitMessage {
  readonly type: 'init';
  readonly pyodideVersion: string;
}
interface FetchMessage {
  readonly type: 'fetch';
  readonly input: FetchInput;
}
type Inbound = InitMessage | FetchMessage;

interface InitReadyMessage {
  readonly type: 'init-ready';
}
interface LogMessage {
  readonly type: 'log';
  readonly line: string;
}
interface FetchResultMessage {
  readonly type: 'fetch-result';
  readonly inventory: unknown;
}
interface ErrorMessage {
  readonly type: 'error';
  readonly message: string;
  readonly name: string;
}
type Outbound = InitReadyMessage | LogMessage | FetchResultMessage | ErrorMessage;

interface PyodideLike {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackage(names: string | string[]): Promise<void>;
  FS: {
    readFile(path: string, opts?: { encoding?: string }): string;
  };
  globals: { set(name: string, value: unknown): void };
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let pyodide: PyodideLike | null = null;

const post = (msg: Outbound) => ctx.postMessage(msg);
const log = (line: string) => post({ type: 'log', line });

const INVENTORY_PATH = '/home/pyodide/saves_inventory.json';

async function initialise(version: string): Promise<void> {
  if (pyodide) return;
  log('Loading Pyodide…');
  const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/pyodide.mjs`;
  const mod = (await import(/* @vite-ignore */ url)) as {
    loadPyodide: (opts?: unknown) => Promise<PyodideLike>;
  };
  pyodide = await mod.loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${version}/full/`,
  });

  // Stream Python stdout/stderr into log messages so the run-page log shows
  // bsky-saves' progress prints as they happen.
  pyodide.globals.set('_log_emit', (line: string) => log(line));
  await pyodide.runPythonAsync(`
import sys
class _LineWriter:
    def __init__(self, fn):
        self._fn = fn
        self._buf = ''
    def write(self, s):
        self._buf += s
        while '\\n' in self._buf:
            line, self._buf = self._buf.split('\\n', 1)
            line = line.rstrip()
            if line:
                self._fn(line)
        return len(s)
    def flush(self):
        line = self._buf.rstrip()
        self._buf = ''
        if line:
            self._fn(line)
    def isatty(self):
        return False
    def writable(self):
        return True
    def readable(self):
        return False
    def fileno(self):
        raise OSError('LineWriter has no fileno')
sys.stdout = _LineWriter(_log_emit)
sys.stderr = _LineWriter(_log_emit)
`);

  log('Installing native packages…');
  // ssl is unvendored from Pyodide's stdlib; httpcore imports it
  // unconditionally so it must be loaded explicitly.
  await pyodide.loadPackage(['micropip', 'ssl']);

  log('Installing bsky-saves…');
  // bsky-saves' top-level deps are httpx and trafilatura. trafilatura's
  // transitive tree pulls in C-extension and mypyc-only wheels that micropip
  // can't install from PyPI. Article hydration isn't wired up in the app yet,
  // so install bsky-saves with deps=False and pull in just httpx ourselves.
  // Article-hydration code paths in bsky-saves will raise ImportError if
  // invoked, but the app doesn't invoke them yet.
  await pyodide.runPythonAsync(`
import micropip
await micropip.install('pyodide-http')
import pyodide_http
pyodide_http.patch_all()
await micropip.install('httpx')
await micropip.install('bsky-saves', deps=False)

# pyodide-http patches urllib/urllib3/requests but NOT httpx, which uses
# httpcore that tries raw sockets. Replace the httpx surface bsky-saves
# touches with a urllib-backed shim so its requests go through the patched
# fetch pipe.
import httpx as _httpx
import urllib.request as _ureq
import urllib.error as _uerr
from urllib.parse import urlencode as _urlencode
import json as _json

class _ShimResponse:
    def __init__(self, status_code, headers, content):
        self.status_code = status_code
        self.headers = headers
        self.content = content
        self.text = content.decode('utf-8', errors='replace') if content else ''
    def json(self):
        return _json.loads(self.text)
    def raise_for_status(self):
        if not (200 <= self.status_code < 400):
            raise _httpx.HTTPStatusError(
                f'HTTP {self.status_code}', request=None, response=self
            )

def _shim_request(method, url, *, json=None, data=None, headers=None, params=None, **_):
    h = dict(headers) if headers else {}
    body = None
    if json is not None:
        body = _json.dumps(json).encode('utf-8')
        h.setdefault('content-type', 'application/json')
    elif data is not None:
        if isinstance(data, (bytes, bytearray)):
            body = bytes(data)
        elif isinstance(data, str):
            body = data.encode('utf-8')
        else:
            body = _urlencode(data).encode('utf-8')
            h.setdefault('content-type', 'application/x-www-form-urlencoded')
    if params:
        url = url + ('&' if '?' in url else '?') + _urlencode(params)
    req = _ureq.Request(url, data=body, headers=h, method=method)
    try:
        r = _ureq.urlopen(req)
        return _ShimResponse(r.status, dict(r.headers), r.read())
    except _uerr.HTTPError as e:
        return _ShimResponse(e.code, dict(e.headers), e.read())

_httpx.post = lambda url, **kw: _shim_request('POST', url, **kw)
_httpx.get  = lambda url, **kw: _shim_request('GET', url, **kw)
_httpx.put  = lambda url, **kw: _shim_request('PUT', url, **kw)
_httpx.delete = lambda url, **kw: _shim_request('DELETE', url, **kw)

class _ShimClient:
    def __init__(self, *args, **kw):
        self._headers = dict(kw.get('headers') or {})
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False
    def close(self):
        pass
    def request(self, method, url, **kw):
        kw['headers'] = {**self._headers, **(kw.get('headers') or {})}
        return _shim_request(method, url, **kw)
    def get(self, url, **kw):
        return self.request('GET', url, **kw)
    def post(self, url, **kw):
        return self.request('POST', url, **kw)
    def put(self, url, **kw):
        return self.request('PUT', url, **kw)
    def delete(self, url, **kw):
        return self.request('DELETE', url, **kw)

_httpx.Client = _ShimClient

import os
os.makedirs('/home/pyodide', exist_ok=True)
os.chdir('/home/pyodide')
`);
}

async function runFetch(input: FetchInput): Promise<unknown> {
  if (!pyodide) throw new Error('Worker not initialised');

  // If the main thread already authenticated, monkey-patch
  // bsky_saves.auth.create_session to return that session and skip the second
  // POST. Some PDSs (eurosky.social) hang the worker's sync XHR createSession
  // even though browser fetch to the same endpoint succeeds; reusing the
  // pre-fetched JWT avoids that hang entirely.
  if (input.preauthSession) {
    const sessionJson = JSON.stringify(input.preauthSession);
    await pyodide.runPythonAsync(`
import bsky_saves.auth as _bsky_auth
import bsky_saves.fetch as _bsky_fetch
import json as _json
_preauth = _json.loads(${JSON.stringify(sessionJson)})
def _patched_create_session(pds_base, handle, app_password):
    return _preauth
# Patch both the source module and the local binding in fetch.py (which did
# \`from .auth import create_session\`, capturing the original by reference).
_bsky_auth.create_session = _patched_create_session
_bsky_fetch.create_session = _patched_create_session
print('reusing pre-authenticated session from main thread')
`);
  }

  log('Fetching saves…');
  await pyodide.runPythonAsync(`
import os
os.environ['BSKY_HANDLE'] = ${JSON.stringify(input.handle)}
os.environ['BSKY_APP_PASSWORD'] = ${JSON.stringify(input.appPassword)}
os.environ['BSKY_PDS'] = ${JSON.stringify(input.pds)}
`);

  await pyodide.runPythonAsync(`
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
    log('Enriching…');
    await pyodide.runPythonAsync(`
from pathlib import Path
import bsky_saves.enrich as _bsky_enrich
_bsky_enrich.enrich_inventory(Path('${INVENTORY_PATH}'))
`);
  }

  if (input.threads) {
    log('Hydrating threads…');
    await pyodide.runPythonAsync(`
from pathlib import Path
import bsky_saves.threads as _bsky_threads
hydrated, skipped = _bsky_threads.hydrate_threads(Path('${INVENTORY_PATH}'))
print(f'bsky-saves: thread hydration done — {hydrated} hydrated, {skipped} skipped')
`);
  }

  log('Reading inventory…');
  const raw = pyodide.FS.readFile(INVENTORY_PATH, { encoding: 'utf8' });
  log('Done.');
  return JSON.parse(raw);
}

ctx.addEventListener('message', async (event: MessageEvent<Inbound>) => {
  try {
    const msg = event.data;
    if (msg.type === 'init') {
      await initialise(msg.pyodideVersion);
      post({ type: 'init-ready' });
    } else if (msg.type === 'fetch') {
      const inventory = await runFetch(msg.input);
      post({ type: 'fetch-result', inventory });
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : 'Error',
    });
  }
});
