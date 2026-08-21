import { MerchandisePanel } from '@/components/settings/MerchandisePanel';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). "Settings → Merchandise" —
 * the product catalog management surface. Self-scoped like every other
 * settings page; the underlying routes enforce merchandise.read/.manage.
 */
export default function MerchandiseSettingsPage() {
  return (
    <div>
      <h1>Merchandise</h1>
      <MerchandisePanel />
    </div>
  );
}
