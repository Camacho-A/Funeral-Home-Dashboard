'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useProductVariants, useCreateVariant, useArchiveVariant } from '@/hooks/useMerchandise';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Phase 37 (ADR-041). Variant editor for one merchandise product. Lists
 * variants (SKU, option values, price/cost/taxability/supplier overrides) and
 * creates/archives them. All authority is server-side (merchandise.manage at
 * the route; SKU uniqueness, bifurcation/transition/archive guards in the
 * service). A blank override inherits the parent product's value. Non-variant
 * product workflows are unchanged — this panel is only shown for a product
 * managed as a variant parent.
 */
function dollarsToCents(value: string): number {
  return Math.round(Number(value) * 100);
}

export function VariantsPanel({ productId, productName }: { productId: string; productName: string }) {
  const { organizationId } = useOrganization();
  const variantsQuery = useProductVariants(organizationId, productId, true);
  const createMutation = useCreateVariant(organizationId, productId);
  const archiveMutation = useArchiveVariant(organizationId, productId);

  const [form, setForm] = useState({ sku: '', name: '', options: '', retailPriceOverride: '', costOverride: '', supplierIdOverride: '' });
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let optionValues: Record<string, string> | null = null;
    if (form.options.trim()) {
      // "Material=Bronze, Size=Companion"
      optionValues = {};
      for (const pair of form.options.split(',')) {
        const [k, v] = pair.split('=').map((s) => s.trim());
        if (k && v) optionValues[k] = v;
      }
    }
    try {
      await createMutation.mutateAsync({
        organizationId,
        sku: form.sku.trim(),
        name: form.name.trim(),
        optionValues,
        retailPriceOverride: form.retailPriceOverride ? dollarsToCents(form.retailPriceOverride) : null,
        costOverride: form.costOverride ? dollarsToCents(form.costOverride) : null,
        supplierIdOverride: form.supplierIdOverride.trim() || null,
      });
      setForm({ sku: '', name: '', options: '', retailPriceOverride: '', costOverride: '', supplierIdOverride: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create variant.');
    }
  }

  async function handleArchive(variantId: string) {
    setError(null);
    try {
      await archiveMutation.mutateAsync(variantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive variant.');
    }
  }

  const variants = variantsQuery.data ?? [];

  return (
    <Card>
      <h3>Variants — {productName}</h3>
      {variantsQuery.isPending ? (
        <p>Loading…</p>
      ) : variants.length === 0 ? (
        <EmptyState message="No variants yet. Add one below to make this a variant parent." />
      ) : (
        <ul aria-label="variant list">
          {variants.map((v) => (
            <li key={v.id}>
              <strong>{v.name}</strong> — {v.sku}
              {v.optionValues ? ` (${Object.entries(JSON.parse(v.optionValues) as Record<string, string>).map(([k, val]) => `${k}: ${val}`).join(', ')})` : ''}
              {v.retailPriceOverride != null ? ` · price $${(v.retailPriceOverride / 100).toFixed(2)}` : ' · price inherited'}
              {!v.isActive && ' · archived'}
              {v.isActive && (
                <Button variant="secondary" onClick={() => handleArchive(v.id)} disabled={archiveMutation.isPending}>
                  Archive
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} aria-label="add variant">
        <TextField placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
        <TextField placeholder="Name (e.g. Bronze / Companion)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <TextField placeholder="Options (Material=Bronze, Size=Companion)" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} />
        <TextField placeholder="Retail price override ($, blank = inherit)" value={form.retailPriceOverride} onChange={(e) => setForm({ ...form, retailPriceOverride: e.target.value })} />
        <TextField placeholder="Cost override ($, blank = inherit)" value={form.costOverride} onChange={(e) => setForm({ ...form, costOverride: e.target.value })} />
        <TextField placeholder="Supplier override (supplier ID, blank = inherit)" value={form.supplierIdOverride} onChange={(e) => setForm({ ...form, supplierIdOverride: e.target.value })} />
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Adding…' : 'Add Variant'}
        </Button>
      </form>
      {error && <div role="alert">{error}</div>}
    </Card>
  );
}
