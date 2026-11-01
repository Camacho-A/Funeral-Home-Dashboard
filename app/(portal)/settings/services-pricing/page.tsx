import { ServicesPricingPanel } from '@/components/settings/ServicesPricingPanel';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). "Settings → Services &
 * Pricing" — the organization's service catalog with editable prices.
 * Self-scoped like every other settings page; the underlying route
 * (PATCH /api/service-catalog/[itemId]) enforces `serviceCatalog.edit`.
 */
export default function ServicesPricingSettingsPage() {
  return (
    <div>
      <h1>Services &amp; Pricing</h1>
      <ServicesPricingPanel />
    </div>
  );
}
