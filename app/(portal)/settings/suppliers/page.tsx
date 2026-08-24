import { SuppliersPanel } from '@/components/settings/SuppliersPanel';

/** Phase 36 (Procurement & Accounts Payable). Settings → Suppliers. Routes
    enforce procurement.read/.manage. */
export default function SuppliersSettingsPage() {
  return (
    <div>
      <h1>Suppliers</h1>
      <SuppliersPanel />
    </div>
  );
}
