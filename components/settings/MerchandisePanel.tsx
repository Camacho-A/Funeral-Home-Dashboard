'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMerchandiseProducts, useCreateMerchandiseProduct, useArchiveMerchandiseProduct } from '@/hooks/useMerchandise';
import { listMerchandiseCategories } from '@/domain/merchandise/merchandiseCategoryRegistry';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import { VariantsPanel } from '@/components/settings/VariantsPanel';

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
  const [variantsFor, setVariantsFor] = useState<{ id: string; name: string } | null>(null);

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
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Merchandise</h2>
      </div>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Add a product</h3>
        <form onSubmit={handleCreate}>
          <div className="sx-form-grid">
            <TextField className="sx-input" placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
            {/* SOLIS-wide ALL-CAPS data standard (2026-09): UX-only — the
                server (services/merchandiseService.ts) normalizes
                authoritatively. */}
            <TextField className="sx-input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })} required />
            <SelectField className="sx-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.displayName}
                </option>
              ))}
            </SelectField>
            <TextField className="sx-input" type="number" step="0.01" placeholder="Cost ($)" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            <TextField className="sx-input" type="number" step="0.01" placeholder="Retail price ($)" value={form.retailPrice} onChange={(e) => setForm({ ...form, retailPrice: e.target.value })} />
            <TextField className="sx-input" type="number" placeholder="Reorder point" value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} />
            <label className="sx-check">
              <input type="checkbox" checked={form.familyVisible} onChange={(e) => setForm({ ...form, familyVisible: e.target.checked })} /> Visible to family
            </label>
          </div>
          {error && <div className="sx-form-banner sx-form-banner-error" role="alert">{error}</div>}
          <div className="sx-save-row">
            <button type="submit" className="sx-btn sx-btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Adding…' : 'Add product'}
            </button>
          </div>
        </form>
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Catalog</h3>
        {products.length === 0 ? (
          <EmptyState message="No merchandise products yet." />
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table sx-table-stack">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th className="sx-num">Retail</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.5 }}>
                    <td data-label="SKU" className="sx-mono">{p.sku}</td>
                    <td data-label="Name" data-primary className="sx-cell-title">{p.name}{p.hasVariants ? ' (variant parent)' : ''}</td>
                    <td data-label="Category">{p.category}</td>
                    <td data-label="Retail" className="sx-num">{p.hasVariants ? '—' : `$${(p.retailPrice / 100).toFixed(2)}`}</td>
                    <td data-label="Status">{p.isActive ? <span className="sx-status sx-status-ok">Active</span> : <span className="sx-status">Archived</span>}</td>
                    <td className="sx-row-actions">
                      <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setVariantsFor(variantsFor?.id === p.id ? null : { id: p.id, name: p.name })}>
                        {variantsFor?.id === p.id ? 'Hide variants' : 'Variants'}
                      </button>
                      {p.isActive && <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => archiveMutation.mutate(p.id)}>Archive</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {variantsFor && <VariantsPanel productId={variantsFor.id} productName={variantsFor.name} />}
    </div>
  );
}
