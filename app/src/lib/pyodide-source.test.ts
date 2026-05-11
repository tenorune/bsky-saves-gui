import { describe, it, expect, vi } from 'vitest';
import { resolvePyodideSource } from './pyodide-source';

describe('resolvePyodideSource', () => {
  it('returns "cdn" when the local flag is false (hosted build)', async () => {
    const probe = vi.fn(async () => true);
    const result = await resolvePyodideSource({ localFlag: false, probe });
    expect(result).toBe('cdn');
    expect(probe).not.toHaveBeenCalled();
  });

  it('returns "local" when the local flag is true and the probe succeeds', async () => {
    const probe = vi.fn(async () => true);
    const result = await resolvePyodideSource({ localFlag: true, probe });
    expect(result).toBe('local');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('falls back to "cdn" when the local flag is true but the probe fails', async () => {
    const probe = vi.fn(async () => false);
    const result = await resolvePyodideSource({ localFlag: true, probe });
    expect(result).toBe('cdn');
  });

  it('falls back to "cdn" when the probe throws', async () => {
    const probe = vi.fn(async () => {
      throw new Error('network');
    });
    const result = await resolvePyodideSource({ localFlag: true, probe });
    expect(result).toBe('cdn');
  });
});
