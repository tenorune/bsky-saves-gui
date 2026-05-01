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
