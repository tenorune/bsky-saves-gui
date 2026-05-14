import { describe, expect, it } from 'vitest';
import { reconcileInventory } from './library-refresh';
import type { RetainMode } from './retain-mode';

// The Python ↔ TypeScript reconcile parity gate (v0.6.0 retain-flag,
// requirements doc §4). Each fixture is a shared input/output pair; the
// GUI's reconcileInventory must reproduce the CLI's expected output
// exactly. See ./__fixtures__/retain/README.md for provenance.
interface RetainFixture {
  readonly description: string;
  readonly mode: RetainMode;
  readonly now: string;
  readonly prior_inventory: { readonly fetched_at: string; readonly saves: unknown[] };
  readonly fetch_records: unknown[];
  readonly expected_output_inventory: { readonly fetched_at: string; readonly saves: unknown[] };
}

const fixtures = import.meta.glob<{ default: RetainFixture }>('./__fixtures__/retain/*.json', {
  eager: true,
});

describe('reconcileInventory — golden fixtures (Python/TS parity gate)', () => {
  const entries = Object.entries(fixtures);

  it('loads the full golden-fixture set', () => {
    expect(entries.length).toBe(10);
  });

  for (const [path, mod] of entries) {
    const fixture = mod.default;
    const name = path.split('/').pop();
    it(`${name} — ${fixture.description}`, () => {
      const result = reconcileInventory(
        fixture.fetch_records,
        fixture.prior_inventory,
        fixture.mode,
        fixture.now,
      );
      expect(result).toEqual(fixture.expected_output_inventory);
    });
  }
});
