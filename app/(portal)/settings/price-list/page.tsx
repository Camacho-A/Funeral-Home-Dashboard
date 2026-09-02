import { PriceListPanel } from '@/components/settings/PriceListPanel';

/**
 * Phase 39 (Family Billing & FTC Compliance). Settings page for the FTC
 * General Price List — generation + version management + download.
 */
export default function PriceListSettingsPage() {
  return (
    <div>
      <h1>Price List</h1>
      <PriceListPanel />
    </div>
  );
}
