import { InventoryPanel } from '@/components/settings/InventoryPanel';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). "Settings → Inventory" —
 * stock levels by location, receiving, and audited adjustments. The
 * underlying routes enforce inventory.read/.manage/.adjust.
 */
export default function InventorySettingsPage() {
  return (
    <div>
      <h1>Inventory</h1>
      <InventoryPanel />
    </div>
  );
}
