import { PurchaseOrdersPanel } from '@/components/settings/PurchaseOrdersPanel';

/** Phase 36 (Procurement & Accounts Payable). Settings → Purchase Orders.
    Routes enforce procurement.read/.manage; receiving enforces inventory.manage. */
export default function PurchaseOrdersSettingsPage() {
  return (
    <div>
      <h1>Purchase Orders</h1>
      <PurchaseOrdersPanel />
    </div>
  );
}
