'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMerchandiseProducts, useCreateMerchandiseProduct, useArchiveMerchandiseProduct } from '@/hooks/useMerchandise';
import { listMerchandiseCategories } from '@/domain/merchandise/merchandiseCategoryRegistry';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Settings → Merchandise: the
 * product catalog. Lists products, creates new ones, and archives
 * (never deletes) — gated at the route layer by merchandise.manage. Prices
 * are entered in dollars and converted to integer cents before submission.
 */
function dollarsToCents(value: string): number {
  return Math.round(Number(value) * 100);
}

export function MerchandisePanel() {
  const { organizationId } = useOrganization();
  const productsQuery = useMerchandiseProducts(organizationId, true);
  const createMutation = useCreateMerchandiseProduct(organizationId);
  const archiveMutation = useArchiveMerchandiseProduct(organizationId);

  const categories = listMerchandiseCategories();
  const [form, setForm] = useState({ sku: '', name: '', category: categories[0].key, cost: '', retailPrice: '', reorderPoint: '', familyVisible: false });
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createMutation.mutateAsync({
        organizationId,
        sku: form.sku.trim(),
        name: form.name.trim(),
        category: form.category,
        cost: dollarsToCents(form.cost || '0'),
        retailPrice: dollarsToCents(form.retailPrice || '0'),
        reorderPoint: form.reorderPoint ? Math.trunc(Number(form.reorderPoint)) : null,
        familyVisible: form.familyVisible,
      });
      setForm({ sku: '', name: '', category: categories[0].key, cost: '', retailPrice: '', reorderPoint: '', familyVisible: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create product.');
    }
  }

  const products = productsQuery.data ?? [];

  return (
    <div>
      <Card>
        <h2>Add a product</h2>
        <form onSubmit={handleCreate}>
          <TextField placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
          <TextField placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <SelectField value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.displayName}
              </option>
            ))}
          </SelectField>
          <TextField type="number" step="0.01" placeholder="Cost ($)" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          <TextField type="number" step="0.01" placeholder="Retail price ($)" value={form.retailPrice} onChange={(e) => setForm({ ...form, retailPrice: e.target.value })} />
          <TextField type="number" placeholder="Reorder point" value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} />
          <label>
            <input type="checkbox" checked={form.familyVisible} onChange={(e) => setForm({ ...form, familyVisible: e.target.checked })} /> Visible to family
          </label>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Adding…' : 'Add product'}
          </Button>
        </form>
      </Card>

      <Card>
        <h2>Catalog</h2>
        {products.length === 0 ? (
          <EmptyState message="No merchandise products yet." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>Retail</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.5 }}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category}</td>
                  <td>${(p.retailPrice / 100).toFixed(2)}</td>
                  <td>{p.isActive ? 'Active' : 'Archived'}</td>
                  <td>{p.isActive && <Button variant="secondary" onClick={() => archiveMutation.mutate(p.id)}>Archive</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
