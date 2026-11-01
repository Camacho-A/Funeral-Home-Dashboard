'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useServiceCatalog, useUpdateServiceCatalogPrice } from '@/hooks/useServiceCatalog';
import { formatCatalogPrice } from '@/utils/format';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ServiceCatalogItem } from '@/types/serviceCatalog';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). Settings → Services & Pricing:
 * the organization's own service catalog, with each row's price editable in
 * dollars (converted to integer cents before submission) or clearable back
 * to "Price not set". Only the price is editable here — names, codes and
 * categories are the catalog's definition, not settings.
 *
 * Authorization is enforced server-side (`serviceCatalog.edit` on PATCH
 * /api/service-catalog/[itemId]); hiding the editor here for a caller
 * without it is a UX nicety, never the security boundary. A price change
 * applies to the next case order calculated — existing orders keep the
 * prices they were saved with.
 */

const CATEGORY_LABELS: Record<string, string> = {
  service_type: 'Service',
  base: 'Base service',
  weight_surcharge: 'Weight surcharge',
  addon: 'Add-on',
};

/** "$1,234.50" / "1234.5" / "1234" -> 123450; anything else (negative,
    more than two decimals, non-numeric) -> null. String-based, so no
    floating-point rounding ever touches the cents value. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function centsToDollarInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

export function ServicesPricingPanel() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const canEdit = Boolean(permissionsQuery.data?.permissions.includes('serviceCatalog.edit'));
  const catalogQuery = useServiceCatalog();

  if (permissionsQuery.isPending || catalogQuery.isPending) {
    return <p className="sx-help">Loading services…</p>;
  }
  if (!canEdit) {
    return <div className="sx-empty"><div className="sx-empty-title">You don&apos;t have access to Services &amp; Pricing.</div></div>;
  }
  if (catalogQuery.isError) {
    return <div className="sx-error-state" role="alert">Failed to load services.</div>;
  }

  const catalog = catalogQuery.data ?? [];
  const unpricedCount = catalog.filter((item) => item.defaultPrice === null).length;

  return (
    <div>
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Services &amp; Pricing</h2>
        <p className="sx-settings-desc">
          Set the price of each service your organization offers. A new price applies to case orders saved from now on — existing orders keep the prices they were saved with.
        </p>
      </div>

      {unpricedCount > 0 && (
        <p className="sx-form-banner sx-form-banner-info">
          {unpricedCount === 1 ? '1 service has' : `${unpricedCount} services have`} no price set. Staff can&apos;t save a case order that includes a service without a price.
        </p>
      )}

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Services</h3>
        {catalog.length === 0 ? (
          <EmptyState message="No services in this organization's catalog yet." />
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table sx-table-stack">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Type</th>
                  <th className="sx-num">Current price</th>
                  <th>New price ($)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {catalog.map((item) => (
                  <ServicePriceRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ServicePriceRow({ item }: { item: ServiceCatalogItem }) {
  const update = useUpdateServiceCatalogPrice();
  const [draft, setDraft] = useState(centsToDollarInput(item.defaultPrice));
  const [error, setError] = useState<string | null>(null);
  const draftCents = draft.trim() === '' ? null : parseDollarsToCents(draft);
  const isInvalid = draft.trim() !== '' && draftCents === null;
  const isUnchanged = draftCents === item.defaultPrice;

  async function save(defaultPrice: number | null) {
    setError(null);
    try {
      const updated = await update.mutateAsync({ itemId: item.id, defaultPrice });
      setDraft(centsToDollarInput(updated.defaultPrice));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update price.');
    }
  }

  return (
    <tr>
      <td data-label="Service" data-primary className="sx-cell-title">
        {item.displayName}
        {item.pricingType === 'per_unit' && <div className="sx-cell-sub">Priced per unit</div>}
      </td>
      <td data-label="Type">{CATEGORY_LABELS[item.category] ?? item.category}</td>
      <td data-label="Current price" className="sx-num">
        {item.defaultPrice === null ? <span className="sx-status">{formatCatalogPrice(null)}</span> : formatCatalogPrice(item.defaultPrice)}
      </td>
      <td data-label="New price ($)">
        <input
          className="sx-input"
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Price for ${item.displayName} (dollars)`}
          aria-invalid={isInvalid ? true : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ maxWidth: 140 }}
        />
        {isInvalid && <div className="sx-error">Enter a dollar amount, e.g. 1250.00</div>}
        {error && <div className="sx-error" role="alert">{error}</div>}
      </td>
      <td>
        <div className="sx-row-actions">
          <button
            type="button"
            className="sx-btn sx-btn-primary sx-btn-sm"
            onClick={() => save(draftCents)}
            disabled={update.isPending || isInvalid || isUnchanged || draftCents === null}
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          {item.defaultPrice !== null && (
            <button
              type="button"
              className="sx-btn sx-btn-ghost sx-btn-sm"
              onClick={() => save(null)}
              disabled={update.isPending}
              aria-label={`Clear price for ${item.displayName}`}
            >
              Clear
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
