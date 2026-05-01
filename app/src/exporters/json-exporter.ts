import type { Inventory } from '../reader/inventory-shape';

export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
}

export async function exportJson(inventory: Inventory): Promise<ExportResult> {
  const text = JSON.stringify(inventory, null, 2);
  return {
    blob: new Blob([text], { type: 'application/json' }),
    filename: 'saves_inventory.json',
  };
}
