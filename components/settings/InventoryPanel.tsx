'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMerchandiseProducts, useInventoryBalances, useReceiveInventory, useAdjustInventory } from '@/hooks/useMerchandise';
import { availableUnits, isLowStock } from '@/domain/merchandise/inventoryMath';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Settings → Inventory: stock
 * by (product, location) with on-hand / reserved / available, low-stock
 * flags, and Receive / Adjust actions. Routes enforce inventory.read/.manage/
 * .adjust. Server-authoritative throughout — nothing here decrements stock
 * itself.
 */
export function InventoryPanel() {
  const { organizationId } = useOrganization();
  const balancesQuery = useInventoryBalances(organizationId);
  const productsQuery = useMerchandiseProducts(organizationId, true);
  const receiveMutation = useReceiveInventory(organizationId);
  const adjustMutation = useAdjustInventory(organizationId);

  const products = productsQuery.data ?? [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const balances = balancesQuery.data ?? [];

  const [receive, setReceive] = useState({ productId: '', locationId: '', quantity: '', unitCost: '' });
  const [error, setError] = useState<string | null>(null);

  async function handleReceive(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await receiveMutation.mutateAsync({
        organizationId,
        productId: receive.productId,
        locationId: receive.locationId.trim(),
        quantity: Math.trunc(Number(receive.quantity)),
        unitCost: Math.round(Number(receive.unitCost || '0') * 100),
      });
      setReceive({ productId: '', locationId: '', quantity: '', unitCost: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to receive inventory.');
    }
  }

  return (
    <div>
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Inventory</h2>
      </div>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Receive stock</h3>
        <form onSubmit={handleReceive}>
          <div className="sx-form-grid">
            <SelectField className="sx-select" value={receive.productId} onChange={(e) => setReceive({ ...receive, productId: e.target.value, locationId: productById.get(e.target.value)?.defaultLocationId ?? receive.locationId })} required>
              <option value="">Select a product…</option>
              {products.filter((p) => p.isActive && p.trackInventory).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </SelectField>
            <TextField className="sx-input" placeholder="Location ID" value={receive.locationId} onChange={(e) => setReceive({ ...receive, locationId: e.target.value })} required />
            <TextField className="sx-input" type="number" placeholder="Quantity" value={receive.quantity} onChange={(e) => setReceive({ ...receive, quantity: e.target.value })} required />
            <TextField className="sx-input" type="number" step="0.01" placeholder="Unit cost ($)" value={receive.unitCost} onChange={(e) => setReceive({ ...receive, unitCost: e.target.value })} />
          </div>
          {error && <div className="sx-form-banner sx-form-banner-error" role="alert">{error}</div>}
          <div className="sx-save-row">
            <button type="submit" className="sx-btn sx-btn-primary" disabled={receiveMutation.isPending}>{receiveMutation.isPending ? 'Receiving…' : 'Receive'}</button>
          </div>
        </form>
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Stock on hand</h3>
        {balances.length === 0 ? (
          <EmptyState message="No inventory yet — receive stock to get started." />
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table sx-table-stack">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Location</th>
                  <th className="sx-num">On hand</th>
                  <th className="sx-num">Reserved</th>
                  <th className="sx-num">Available</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => {
                  const product = productById.get(b.productId);
                  const low = isLowStock(b.onHand, product?.reorderPoint ?? null);
                  return (
                    <tr key={b.id}>
                      <td data-label="Product" data-primary className="sx-cell-title">{product?.name ?? b.productId}</td>
                      <td data-label="Location">{b.locationId}</td>
                      <td data-label="On hand" className="sx-num">{b.onHand}</td>
                      <td data-label="Reserved" className="sx-num">{b.reserved}</td>
                      <td data-label="Available" className="sx-num">{availableUnits(b.onHand, b.reserved)}</td>
                      <td data-label="Status">{low ? <span className="sx-status sx-status-bad">Low stock</span> : <span className="sx-status sx-status-ok">OK</span>}</td>
                      <td className="sx-row-actions">
                        <button
                          type="button"
                          className="sx-btn sx-btn-ghost sx-btn-sm"
                          onClick={() => {
                            const reason = window.prompt('Adjustment reason (required):');
                            const deltaStr = window.prompt('Quantity change (e.g. -1 for shrinkage):');
                            if (!reason || !deltaStr) return;
                            const quantityDelta = Math.trunc(Number(deltaStr));
                            if (!quantityDelta) return;
                            adjustMutation.mutate({ organizationId, productId: b.productId, locationId: b.locationId, quantityDelta, movementType: quantityDelta < 0 ? 'shrinkage' : 'correction', reason });
                          }}
                        >
                          Adjust
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
