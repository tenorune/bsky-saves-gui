// Resolves whether Pyodide should be loaded from the jsdelivr CDN or from a
// same-origin /pyodide/ path served by the local-served helper.
//
// Two inputs:
//   1. Build-time flag VITE_LOCAL_PYODIDE — baked into the local-served build
//      target. Defaults to false for the hosted build.
//   2. Runtime probe — HEAD /pyodide/pyodide.mjs to confirm the helper is
//      actually serving the bundle (defensive against a misconfigured build).
//
// If the flag is false we never probe. If the flag is true and the probe
// fails we fall back to CDN so the worker still has a way to load Pyodide.

export type PyodideSource = 'cdn' | 'local';

export interface ResolveOpts {
  readonly localFlag: boolean;
  readonly probe: () => Promise<boolean>;
}

export async function resolvePyodideSource(opts: ResolveOpts): Promise<PyodideSource> {
  if (!opts.localFlag) return 'cdn';
  try {
    return (await opts.probe()) ? 'local' : 'cdn';
  } catch {
    return 'cdn';
  }
}

const LOCAL_PYODIDE_URL = '/pyodide/pyodide.mjs';

async function defaultProbe(): Promise<boolean> {
  try {
    const res = await fetch(LOCAL_PYODIDE_URL, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

export function resolveDefaultPyodideSource(): Promise<PyodideSource> {
  return resolvePyodideSource({
    localFlag: import.meta.env.VITE_LOCAL_PYODIDE === '1',
    probe: defaultProbe,
  });
}
