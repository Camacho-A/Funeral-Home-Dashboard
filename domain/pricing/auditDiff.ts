import type { ServiceCatalogItem } from '../../types/serviceCatalog';
import type { ServiceSelections } from '../../types/caseOrder';
import { SERVICE_CODES } from './serviceCodes';
import { weightTierLabel, weightTierServiceCode } from './calculateOrder';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Turns two
 * ServiceSelections snapshots into the audit-trail rows
 * services/pricingService.ts appends whenever staff edits a case's
 * services — see types/caseOrderAudit.ts. Pure, catalog-driven (never a
 * hardcoded price), matching the exact "Added: 2 Death Certificates,
 * +$50" / "Changed: Weight, Under 200 -> 201-250, +$290" format the
 * phase's own spec examples use.
 */
export type SelectionDiffEntry = {
  action: string;
  previousValue: string | null;
  newValue: string | null;
  amountDeltaCents: number;
  description: string;
};

function catalogPrice(catalogByCode: Map<string, ServiceCatalogItem>, serviceCode: string | null): number {
  if (!serviceCode) return 0;
  return catalogByCode.get(serviceCode)?.defaultPrice ?? 0;
}

/** Whole-dollar signed display — "+$290"/"-$50" — matching this phase's
    own spec examples; Manor's Cremation's entire price list is
    whole-dollar, so no cents ever need to show here. */
function formatSignedWholeDollars(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(cents) / 100)}`;
}

export function diffSelections(
  catalog: ServiceCatalogItem[],
  previous: ServiceSelections,
  next: ServiceSelections,
): SelectionDiffEntry[] {
  const catalogByCode = new Map(catalog.map((item) => [item.serviceCode, item]));
  const entries: SelectionDiffEntry[] = [];

  if (previous.weightTier !== next.weightTier) {
    const delta =
      catalogPrice(catalogByCode, weightTierServiceCode(next.weightTier)) -
      catalogPrice(catalogByCode, weightTierServiceCode(previous.weightTier));
    const previousLabel = weightTierLabel(previous.weightTier);
    const newLabel = weightTierLabel(next.weightTier);
    entries.push({
      action: 'weight_tier_changed',
      previousValue: previousLabel,
      newValue: newLabel,
      amountDeltaCents: delta,
      description: `Changed: Weight, ${previousLabel} → ${newLabel}, ${formatSignedWholeDollars(delta)}`,
    });
  }

  if (previous.extraDeathCertificateQuantity !== next.extraDeathCertificateQuantity) {
    const unitPrice = catalogPrice(catalogByCode, SERVICE_CODES.EXTRA_DEATH_CERTIFICATE);
    const quantityDelta = next.extraDeathCertificateQuantity - previous.extraDeathCertificateQuantity;
    const delta = quantityDelta * unitPrice;
    const verb = quantityDelta > 0 ? 'Added' : 'Removed';
    entries.push({
      action: 'death_certificate_quantity_changed',
      previousValue: String(previous.extraDeathCertificateQuantity),
      newValue: String(next.extraDeathCertificateQuantity),
      amountDeltaCents: delta,
      description: `${verb}: ${Math.abs(quantityDelta)} Death Certificate${Math.abs(quantityDelta) === 1 ? '' : 's'}, ${formatSignedWholeDollars(delta)}`,
    });
  }

  if (previous.mailCremated !== next.mailCremated) {
    const price = catalogPrice(catalogByCode, SERVICE_CODES.MAIL_CREMATED_REMAINS);
    const delta = next.mailCremated ? price : -price;
    entries.push({
      action: next.mailCremated ? 'mail_cremated_remains_added' : 'mail_cremated_remains_removed',
      previousValue: previous.mailCremated ? 'Included' : 'Not included',
      newValue: next.mailCremated ? 'Included' : 'Not included',
      amountDeltaCents: delta,
      description: `${next.mailCremated ? 'Added' : 'Removed'}: Mail Cremated Remains, ${formatSignedWholeDollars(delta)}`,
    });
  }

  return entries;
}
