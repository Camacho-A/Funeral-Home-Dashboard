'use client';

import { TextField } from '@/components/ui/TextField';
import {
  calculateOrderTotals,
  weightTierLabel,
  weightTierServiceCode,
} from '@/domain/pricing/calculateOrder';
import { MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY } from '@/domain/pricing/calculateOrder';
import { formatCentsAsCurrency } from '@/utils/format';
import type { ServiceCatalogItem } from '@/types/serviceCatalog';
import type { ServiceSelections, WeightTier } from '@/types/caseOrder';
import styles from './ServicesAndChargesSelector.module.css';

const SURCHARGE_TIERS: WeightTier[] = ['201_250', '251_300'];

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The one
 * "Services & Charges" control set, shared between NewCaseModal (initial
 * selection) and EditServicesModal (editing an existing case's order) —
 * built once so both places always calculate and display totals
 * identically. Never hardcodes a serviceCode: the base service and weight
 * tiers are resolved by *role* (weightTierServiceCode maps a tier to
 * whichever catalog row plays that part, if any), and the two addon
 * controls are distinguished by the catalog's own `pricingType`
 * ('per_unit' -> a quantity stepper; 'flat' -> a plain checkbox) — see
 * domain/pricing/serviceCodes.ts's own comment on why that's the one place
 * literal codes appear at all.
 *
 * Known scope limit (matches types/caseOrder.ts's ServiceSelections
 * comment): supports exactly one per-unit addon and one flat addon, since
 * that's what Manor's Cremation's five seeded services need. A future
 * organization with several flat add-ons, or several quantity-driven
 * add-ons, needs a genuinely generalized selections shape this phase
 * doesn't build.
 *
 * The "Live Itemized Summary" below is computed with the exact same pure
 * domain/pricing/calculateOrder.ts function the server uses to persist —
 * never a separate/duplicated calculation — but it is a *preview* only:
 * the server independently re-fetches the catalog and recalculates from
 * the submitted `selections` before ever persisting anything (see
 * services/pricingService.ts). See docs/adr/ADR-023's "client preview vs.
 * server authority" section.
 */
export function ServicesAndChargesSelector({
  catalog,
  selections,
  onChange,
}: {
  catalog: ServiceCatalogItem[];
  selections: ServiceSelections;
  onChange: (next: ServiceSelections) => void;
}) {
  const baseService = catalog.find((item) => item.category === 'base');
  const addons = catalog.filter((item) => item.category === 'addon');
  const perUnitAddon = addons.find((item) => item.pricingType === 'per_unit');
  const flatAddon = addons.find((item) => item.pricingType === 'flat');

  const preview = calculateOrderTotals(catalog, selections);

  function setWeightTier(tier: WeightTier) {
    onChange({ ...selections, weightTier: tier });
  }

  function setExtraDeathCertificateQuantity(raw: string) {
    const parsed = Math.trunc(Number(raw));
    const quantity = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY) : 0;
    onChange({ ...selections, extraDeathCertificateQuantity: quantity });
  }

  function toggleFlatAddon() {
    onChange({ ...selections, mailCremated: !selections.mailCremated });
  }

  return (
    <div className={styles.wrapper}>
      {baseService && (
        <div className={styles.staticRow}>
          <span>{baseService.displayName}</span>
          <span className={styles.readOnlyBadge}>Always included</span>
        </div>
      )}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Weight</legend>
        <label className={styles.radioRow}>
          <input
            type="radio"
            name="weightTier"
            checked={selections.weightTier === 'under_200'}
            onChange={() => setWeightTier('under_200')}
          />
          {weightTierLabel('under_200')}
        </label>
        {SURCHARGE_TIERS.map((tier) => {
          const serviceCode = weightTierServiceCode(tier);
          const catalogItem = serviceCode ? catalog.find((item) => item.serviceCode === serviceCode) : undefined;
          if (!catalogItem) return null;
          return (
            <label key={tier} className={styles.radioRow}>
              <input
                type="radio"
                name="weightTier"
                checked={selections.weightTier === tier}
                onChange={() => setWeightTier(tier)}
              />
              {weightTierLabel(tier)}
              <span className={styles.priceHint}>{formatCentsAsCurrency(catalogItem.defaultPrice, 'usd')}</span>
            </label>
          );
        })}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Additional Services</legend>

        {flatAddon && (
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={selections.mailCremated} onChange={toggleFlatAddon} />
            {flatAddon.displayName}
            <span className={styles.priceHint}>{formatCentsAsCurrency(flatAddon.defaultPrice, 'usd')}</span>
          </label>
        )}

        {perUnitAddon && (
          <div className={styles.quantityRow}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={selections.extraDeathCertificateQuantity > 0}
                onChange={() => setExtraDeathCertificateQuantity(selections.extraDeathCertificateQuantity > 0 ? '0' : '1')}
              />
              {perUnitAddon.displayName}
              <span className={styles.priceHint}>{formatCentsAsCurrency(perUnitAddon.defaultPrice, 'usd')} each</span>
            </label>
            {selections.extraDeathCertificateQuantity > 0 && (
              <TextField
                type="number"
                min={1}
                max={MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY}
                value={selections.extraDeathCertificateQuantity}
                onChange={(e) => setExtraDeathCertificateQuantity(e.target.value)}
                aria-label={`${perUnitAddon.displayName} quantity`}
                className={styles.quantityInput}
              />
            )}
          </div>
        )}
      </fieldset>

      <div className={styles.summary}>
        <div className={styles.summaryTitle}>Live Itemized Summary</div>
        {preview.lineItems.map((item) => (
          <div key={item.serviceCode} className={styles.summaryRow}>
            <span>
              {item.description}
              {item.quantity > 1 ? ` x${item.quantity}` : ''}
            </span>
            <span>{formatCentsAsCurrency(item.lineTotal, 'usd')}</span>
          </div>
        ))}
        <div className={styles.summaryTotalRow}>
          <span>Total</span>
          <span>{formatCentsAsCurrency(preview.total, 'usd')}</span>
        </div>
      </div>
    </div>
  );
}
