import { describe, expect, it } from 'vitest';
import type { Inventory } from '../reader/inventory-shape';

const sample: Inventory = {
  saves: [
    {
      uri: 'at://x/y/1',
      cid: 'c',
      author: { did: 'd', handle: 'h.example' },
      record: { text: 'hi', createdAt: '2026-04-01T00:00:00Z' },
      indexedAt: '2026-04-01T00:00:00Z',
    },
  ],
};

describe('jsonExporter', () => {
  it('returns a Blob with the inventory JSON', async () => {
    const { exportJson } = await import('./json-exporter');
    const result = await exportJson(sample);
    expect(result.filename).toBe('saves_inventory.json');
    expect(result.blob.type).toBe('application/json');
    const text = await result.blob.text();
    expect(JSON.parse(text)).toEqual(sample);
  });

  it('formats with two-space indentation', async () => {
    const { exportJson } = await import('./json-exporter');
    const result = await exportJson(sample);
    const text = await result.blob.text();
    expect(text).toContain('\n  "saves"');
  });
});
