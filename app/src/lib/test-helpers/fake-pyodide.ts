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
