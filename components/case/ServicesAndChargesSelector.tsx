'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  calculateOrderTotals,
  weightTierLabel,
  weightTierServiceCode,
  MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY,
  MAX_KEEPSAKE_TRANSFER_QUANTITY,
  MAX_CUSTOM_ITEM_DESCRIPTION_LENGTH,
} from '@/domain/pricing/calculateOrder';
import { SERVICE_CODES } from '@/domain/pricing/serviceCodes';
import { formatCentsAsCurrency } from '@/utils/format';
import type { ServiceCatalogItem } from '@/types/serviceCatalog';
import type { ServiceSelections, WeightTier, CustomLineItemSelection } from '@/types/caseOrder';
import styles from './ServicesAndChargesSelector.module.css';

function dollarsToCents(input: string): number | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const SURCHARGE_TIERS: WeightTier[] = ['201_250', '251_300'];

type QuantityAddonConfig = {
  serviceCode: string;
  quantity: number;
  max: number;
  setQuantity: (quantity: number) => void;
};

type FlatAddonConfig = {
  serviceCode: string;
  selected: boolean;
  toggle: () => void;
};

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The one
 * "Services & Charges" control set, shared between NewCaseModal (initial
 * selection) and EditServicesModal (editing an existing case's order) —
 * built once so both places always calculate and display totals
 * identically. Never hardcodes a serviceCode's PRICE: every price shown
 * comes straight from the catalog row (`item.defaultPrice`); a serviceCode
 * itself only ever names which selections field/UI role it plays.
 *
 * Manors launch-prep — additional case charges: generalized from exactly
 * one per-unit addon + one flat addon (this file's own prior "known scope
 * limit") to an explicit, small, named list of each — Additional Death
 * Certificate + Keepsake Transfer (quantity, "[-] N [+]" stepper) and Mail
 * Cremated Remains + Urn Transfer + Shipping (flat, "Add"/"Added" toggle).
 * Still not a fully generic "loop over every catalog addon" system —
 * deliberately: this is a small, known, named set of charges, matching
 * "keep scope small," not a general price-customization engine. A
 * catalog row that doesn't exist for an organization simply never renders
 * its control (silently omitted, same as every other lookup in this file).
 *
 * The "Live Itemized Summary" below is computed with the exact same pure
 * domain/pricing/calculateOrder.ts function the server uses to persist —
 * never a separate/duplicated calculation — but it is a *preview* only:
 * the server independently re-fetches the catalog and recalculates from
 * the submitted `selections` before ever persisting anything (see
 * services/pricingService.ts). See docs/adr/ADR-023's "client preview vs.
 * server authority" section.
 */
export type ServicesAndChargesSelectorHandle = {
  /**
   * Commits a custom item the user typed but never pressed "Add Custom
   * Item" for, and returns the complete custom-item list including it —
   * or null when there is no valid pending draft.
   *
   * Exists because the draft lives in this component's own state, so a
   * parent's Save had no way to see it: typing a description and price
   * and pressing Save directly sent `customItems: []` and silently
   * discarded the entry (it was also absent from the preview total, since
   * only committed items are summed). Returning the list rather than
   * relying on `onChangeCustomItems` matters — the parent's own state
   * update from that callback is not visible synchronously within the
   * same event handler.
   */
  commitPendingCustomItem: () => CustomLineItemSelection[] | null;
};

export const ServicesAndChargesSelector = forwardRef<
  ServicesAndChargesSelectorHandle,
  {
    catalog: ServiceCatalogItem[];
    selections: ServiceSelections;
    onChange: (next: ServiceSelections) => void;
    customItems?: CustomLineItemSelection[];
    onChangeCustomItems?: (next: CustomLineItemSelection[]) => void;
  }
>(function ServicesAndChargesSelector({
  catalog,
  selections,
  onChange,
  customItems,
  onChangeCustomItems,
}: {
  catalog: ServiceCatalogItem[];
  selections: ServiceSelections;
  onChange: (next: ServiceSelections) => void;
  /** SOLIS cleanup item #11 (2026-09). Case-specific, one-off charges —
      never a ServiceCatalog/MerchandiseProduct write, see
      domain/pricing/calculateOrder.ts's own comment. Omitted entirely
      (undefined) for the first-time "Set Up Services & Charges" flow
      (NewCaseModal) — a custom item is an ADDITIONAL Items & Services
      concept, only offered once a real Case Order/decedent already exists
      to attach it to. */
  customItems?: CustomLineItemSelection[];
  onChangeCustomItems?: (next: CustomLineItemSelection[]) => void;
}, ref) {
  const baseService = catalog.find((item) => item.category === 'base');

  const preview = calculateOrderTotals(catalog, selections);
  const customItemsTotal = (customItems ?? []).reduce((sum, item) => sum + item.amountCents, 0);
  const combinedTotal = preview.total + customItemsTotal;

  const [draftDescription, setDraftDescription] = useState('');
  const [draftAmount, setDraftAmount] = useState('');
  // A blank price is a missing required field, never an implicit $0.00 —
  // `dollarsToCents('')` would otherwise coerce to 0 via `Number('')`.
  const draftAmountCents = draftAmount.trim() === '' ? null : dollarsToCents(draftAmount);

  /** The single commit path, shared by the "Add Custom Item" button and
      the parent-triggered flush on Save, so the two can never diverge.
      Returns the resulting list (null when there is nothing valid to
      commit) — the button ignores it, the flush needs it. */
  function commitDraftCustomItem(): CustomLineItemSelection[] | null {
    const description = draftDescription.trim();
    if (!description || draftAmountCents === null || !onChangeCustomItems) return null;
    const next = [
      ...(customItems ?? []),
      { id: crypto.randomUUID(), description, amountCents: draftAmountCents },
    ];
    onChangeCustomItems(next);
    setDraftDescription('');
    setDraftAmount('');
    return next;
  }

  function addCustomItem() {
    commitDraftCustomItem();
  }

  useImperativeHandle(ref, () => ({ commitPendingCustomItem: commitDraftCustomItem }));

  function removeCustomItem(id: string) {
    if (!onChangeCustomItems) return;
    onChangeCustomItems((customItems ?? []).filter((item) => item.id !== id));
  }

  function setWeightTier(tier: WeightTier) {
    onChange({ ...selections, weightTier: tier });
  }

  function clampQuantity(raw: number, max: number): number {
    return Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 0), max) : 0;
  }

  const quantityAddons: QuantityAddonConfig[] = [
    {
      serviceCode: SERVICE_CODES.EXTRA_DEATH_CERTIFICATE,
      quantity: selections.extraDeathCertificateQuantity,
      max: MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY,
      setQuantity: (quantity) => onChange({ ...selections, extraDeathCertificateQuantity: quantity }),
    },
    {
      serviceCode: SERVICE_CODES.KEEPSAKE_TRANSFER,
      quantity: selections.keepsakeTransferQuantity,
      max: MAX_KEEPSAKE_TRANSFER_QUANTITY,
      setQuantity: (quantity) => onChange({ ...selections, keepsakeTransferQuantity: quantity }),
    },
  ];

  const flatAddons: FlatAddonConfig[] = [
    {
      serviceCode: SERVICE_CODES.MAIL_CREMATED_REMAINS,
      selected: selections.mailCremated,
      toggle: () => onChange({ ...selections, mailCremated: !selections.mailCremated }),
    },
    {
      serviceCode: SERVICE_CODES.URN_TRANSFER,
      selected: selections.urnTransfer,
      toggle: () => onChange({ ...selections, urnTransfer: !selections.urnTransfer }),
    },
    {
      serviceCode: SERVICE_CODES.SHIPPING,
      selected: selections.shipping,
      toggle: () => onChange({ ...selections, shipping: !selections.shipping }),
    },
  ];

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
        <legend className={styles.legend}>Additional Charges</legend>

        {quantityAddons.map((addon) => {
          const catalogItem = catalog.find((item) => item.serviceCode === addon.serviceCode);
          if (!catalogItem) return null;
          return (
            <div key={addon.serviceCode} className={styles.stepperRow}>
              <span className={styles.stepperLabel}>
                {catalogItem.displayName}
                <span className={styles.priceHint}>{formatCentsAsCurrency(catalogItem.defaultPrice, 'usd')} each</span>
              </span>
              <div className={styles.stepperControl}>
                <button
                  type="button"
                  className={styles.stepperButton}
                  onClick={() => addon.setQuantity(clampQuantity(addon.quantity - 1, addon.max))}
                  disabled={addon.quantity <= 0}
                  aria-label={`Decrease ${catalogItem.displayName} quantity`}
                >
                  −
                </button>
                <span className={styles.stepperValue} aria-label={`${catalogItem.displayName} quantity`}>
                  {addon.quantity}
                </span>
                <button
                  type="button"
                  className={styles.stepperButton}
                  onClick={() => addon.setQuantity(clampQuantity(addon.quantity + 1, addon.max))}
                  disabled={addon.quantity >= addon.max}
                  aria-label={`Increase ${catalogItem.displayName} quantity`}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}

        {flatAddons.map((addon) => {
          const catalogItem = catalog.find((item) => item.serviceCode === addon.serviceCode);
          if (!catalogItem) return null;
          return (
            <div key={addon.serviceCode} className={styles.stepperRow}>
              <span className={styles.stepperLabel}>
                {catalogItem.displayName}
                <span className={styles.priceHint}>{formatCentsAsCurrency(catalogItem.defaultPrice, 'usd')}</span>
              </span>
              {addon.selected ? (
                <Button variant="secondary" onClick={addon.toggle} aria-label={`Remove ${catalogItem.displayName}`}>
                  Added ✕
                </Button>
              ) : (
                <Button variant="secondary" onClick={addon.toggle} aria-label={`Add ${catalogItem.displayName}`}>
                  Add
                </Button>
              )}
            </div>
          );
        })}
      </fieldset>

      {onChangeCustomItems && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Custom Item</legend>
          <p className={styles.customItemHint}>
            For a one-off family request not in the list above. Added only to this case&rsquo;s order — never a permanent price-list item.
          </p>

          {(customItems ?? []).map((item) => (
            <div key={item.id} className={styles.customItemRow}>
              <span>{item.description}</span>
              <span className={styles.customItemAmount}>
                <span>{formatCentsAsCurrency(item.amountCents, 'usd')}</span>
                <button
                  type="button"
                  onClick={() => removeCustomItem(item.id)}
                  aria-label={`Remove ${item.description}`}
                  className={styles.customItemRemove}
                >
                  ×
                </button>
              </span>
            </div>
          ))}

          <div className={styles.customItemForm}>
            <input
              aria-label="Custom item description"
              placeholder="Description"
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value.slice(0, MAX_CUSTOM_ITEM_DESCRIPTION_LENGTH))}
            />
            <input
              aria-label="Custom item price (dollars)"
              placeholder="Price"
              inputMode="decimal"
              value={draftAmount}
              onChange={(e) => setDraftAmount(e.target.value)}
              className={styles.customItemPriceInput}
            />
            <Button
              variant="secondary"
              onClick={addCustomItem}
              disabled={!draftDescription.trim() || draftAmountCents === null}
            >
              Add Custom Item
            </Button>
          </div>
        </fieldset>
      )}

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
        {(customItems ?? []).map((item) => (
          <div key={item.id} className={styles.summaryRow}>
            <span>{item.description}</span>
            <span>{formatCentsAsCurrency(item.amountCents, 'usd')}</span>
          </div>
        ))}
        <div className={styles.summaryTotalRow}>
          <span>Total</span>
          <span>{formatCentsAsCurrency(combinedTotal, 'usd')}</span>
        </div>
      </div>
    </div>
  );
});
