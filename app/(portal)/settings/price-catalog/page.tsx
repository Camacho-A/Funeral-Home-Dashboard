'use client';

import { PriceCatalogPanel } from '@/components/settings/PriceCatalogPanel';
import { SettingsAreaUnavailable } from '@/components/settings/SettingsAreaUnavailable';
import { useOrganization } from '@/hooks/useOrganization';
import { isPriceCatalogManaged } from '@/domain/pricing/pricingPermissions';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). "Settings → Price
 * Catalog" — the organization's catalog of services, merchandise and other
 * charges. Self-scoped like every other settings page; read-only without
 * the catalog configuration permission, which every write route enforces.
 *
 * Only for an organization that manages its catalog in SOLIS (2026-11): the
 * settings nav hides it otherwise, and its address says it is not
 * available. Case orders keep reading the catalog as before — this page is
 * the only thing withheld; no catalog data is changed.
 */
export default function PriceCatalogSettingsPage() {
  const { organizationId } = useOrganization();
  if (!isPriceCatalogManaged(organizationId)) {
    return <SettingsAreaUnavailable title="Price Catalog" message="The Price Catalog is not managed in SOLIS for this organization." />;
  }
  return (
    <div>
      <h1>Price Catalog</h1>
      <PriceCatalogPanel />
    </div>
  );
}
