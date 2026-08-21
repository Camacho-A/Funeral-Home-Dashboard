'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMerchandiseProducts, useInventoryBalances, useReceiveInventory, useAdjustInventory } from '@/hooks/useMerchandise';
import { availableUnits, isLowStock } from '@/domain/merchandise/inventoryMath';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { Badge } from '@/components/ui/Badge';
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
      <Card>
        <h2>Receive stock</h2>
        <form onSubmit={handleReceive}>
          <SelectField value={receive.productId} onChange={(e) => setReceive({ ...receive, productId: e.target.value, locationId: productById.get(e.target.value)?.defaultLocationId ?? receive.locationId })} required>
            <option value="">Select a product…</option>
            {products.filter((p) => p.isActive && p.trackInventory).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </SelectField>
          <TextField placeholder="Location ID" value={receive.locationId} onChange={(e) => setReceive({ ...receive, locationId: e.target.value })} required />
          <TextField type="number" placeholder="Quantity" value={receive.quantity} onChange={(e) => setReceive({ ...receive, quantity: e.target.value })} required />
          <TextField type="number" step="0.01" placeholder="Unit cost ($)" value={receive.unitCost} onChange={(e) => setReceive({ ...receive, unitCost: e.target.value })} />
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={receiveMutation.isPending}>{receiveMutation.isPending ? 'Receiving…' : 'Receive'}</Button>
        </form>
      </Card>

      <Card>
        <h2>Stock on hand</h2>
        {balances.length === 0 ? (
          <EmptyState message="No inventory yet — receive stock to get started." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Location</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available</th>
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
                    <td>{product?.name ?? b.productId}</td>
                    <td>{b.locationId}</td>
                    <td>{b.onHand}</td>
                    <td>{b.reserved}</td>
                    <td>{availableUnits(b.onHand, b.reserved)}</td>
                    <td>{low ? <Badge variant="danger">Low stock</Badge> : <Badge variant="success">OK</Badge>}</td>
                    <td>
                      <Button
                        variant="secondary"
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
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
