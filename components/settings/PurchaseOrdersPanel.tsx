'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useSuppliers, usePurchaseOrders, useCreatePurchaseOrder, usePurchaseOrderAction } from '@/hooks/useProcurement';
import { useMerchandiseProducts } from '@/hooks/useMerchandise';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Phase 36 (Procurement & Accounts Payable). Settings → Purchase Orders.
 * Creates a single-line PO (a commitment — no GL posting), then submit /
 * cancel from the list. Gated by procurement.read/.manage at the route
 * layer. Receiving is done from the inventory surface (inventory.manage).
 */
function dollarsToCents(v: string): number {
  return Math.round(Number(v) * 100);
}

export function PurchaseOrdersPanel() {
  const { organizationId } = useOrganization();
  const suppliersQuery = useSuppliers(organizationId, false);
  const productsQuery = useMerchandiseProducts(organizationId, false);
  const ordersQuery = usePurchaseOrders(organizationId);
  const createMutation = useCreatePurchaseOrder(organizationId);
  const actionMutation = usePurchaseOrderAction(organizationId);

  const suppliers = suppliersQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const [form, setForm] = useState({ supplierId: '', locationId: '', productId: '', quantityOrdered: '', unitCost: '' });
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createMutation.mutateAsync({
        organizationId,
        supplierId: form.supplierId,
        locationId: form.locationId.trim(),
        orderDate: new Date().toISOString(),
        lines: [{ productId: form.productId, quantityOrdered: Math.trunc(Number(form.quantityOrdered)), unitCostCents: dollarsToCents(form.unitCost || '0') }],
      });
      setForm({ supplierId: '', locationId: form.locationId, productId: '', quantityOrdered: '', unitCost: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create purchase order.');
    }
  }

  const orders = ordersQuery.data ?? [];

  return (
    <div>
      <Card>
        <h2>New purchase order</h2>
        <form onSubmit={handleCreate}>
          <SelectField value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
            <option value="">Select supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <TextField placeholder="Location ID" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} required />
          <SelectField value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
            <option value="">Select product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </SelectField>
          <TextField type="number" placeholder="Quantity" value={form.quantityOrdered} onChange={(e) => setForm({ ...form, quantityOrdered: e.target.value })} />
          <TextField type="number" step="0.01" placeholder="Unit cost ($)" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={createMutation.isPending || !form.supplierId || !form.productId}>Create PO</Button>
        </form>
      </Card>

      <Card>
        <h2>Purchase orders</h2>
        {orders.length === 0 ? (
          <EmptyState message="No purchase orders yet." />
        ) : (
          <ul>
            {orders.map((po) => (
              <li key={po.id}>
                <strong>{po.poNumber}</strong> — {po.status} — ${(po.subtotalCents / 100).toFixed(2)}{' '}
                {po.status === 'draft' && <Button type="button" onClick={() => actionMutation.mutate({ purchaseOrderId: po.id, action: 'submit' })} disabled={actionMutation.isPending}>Submit</Button>}
                {(po.status === 'draft' || po.status === 'submitted') && <Button type="button" onClick={() => actionMutation.mutate({ purchaseOrderId: po.id, action: 'cancel' })} disabled={actionMutation.isPending}>Cancel</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
