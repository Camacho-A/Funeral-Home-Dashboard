import { PriceCatalogPanel } from '@/components/settings/PriceCatalogPanel';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). "Settings → Price
 * Catalog" — the organization's catalog of services, merchandise and other
 * charges. Self-scoped like every other settings page; read-only without
 * the catalog configuration permission, which every write route enforces.
 */
export default function PriceCatalogSettingsPage() {
  return (
    <div>
      <h1>Price Catalog</h1>
      <PriceCatalogPanel />
    </div>
  );
}
