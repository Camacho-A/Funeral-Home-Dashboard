'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useSuppliers, useCreateSupplier, useArchiveSupplier } from '@/hooks/useProcurement';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Phase 36 (Procurement & Accounts Payable). Settings → Suppliers: the vendor
 * directory. Lists suppliers, creates new ones, and archives (never deletes)
 * — gated at the route layer by procurement.read/.manage.
 */
export function SuppliersPanel() {
  const { organizationId } = useOrganization();
  const suppliersQuery = useSuppliers(organizationId, false);
  const createMutation = useCreateSupplier(organizationId);
  const archiveMutation = useArchiveSupplier(organizationId);

  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '', paymentTermsDays: '' });
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createMutation.mutateAsync({
        organizationId,
        name: form.name.trim(),
        contactName: form.contactName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        paymentTermsDays: form.paymentTermsDays ? Math.trunc(Number(form.paymentTermsDays)) : null,
      });
      setForm({ name: '', contactName: '', email: '', phone: '', paymentTermsDays: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create supplier.');
    }
  }

  const suppliers = suppliersQuery.data ?? [];

  return (
    <div>
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Suppliers</h2>
      </div>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">New supplier</h3>
        <form onSubmit={handleCreate}>
          <div className="sx-form-grid">
            <TextField className="sx-input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <TextField className="sx-input" placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            <TextField className="sx-input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <TextField className="sx-input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <TextField className="sx-input" type="number" placeholder="Payment terms (net days)" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })} />
          </div>
          {error && <div className="sx-form-banner sx-form-banner-error" role="alert">{error}</div>}
          <div className="sx-save-row">
            <button type="submit" className="sx-btn sx-btn-primary" disabled={createMutation.isPending || form.name.trim().length === 0}>Add supplier</button>
          </div>
        </form>
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Supplier list</h3>
        {suppliers.length === 0 ? (
          <EmptyState message="No suppliers yet — add your first supplier above." />
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {suppliers.map((s) => (
              <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, borderBottom: '1px solid var(--sx-border-soft)' }}>
                <span className="sx-cell-title">{s.name}</span>
                {s.paymentTermsDays != null && <span className="sx-cell-sub"> — Net {s.paymentTermsDays}</span>}
                {s.email && <span className="sx-cell-sub"> · {s.email}</span>}
                <span style={{ marginLeft: 'auto' }}>
                  <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => archiveMutation.mutate(s.id)} disabled={archiveMutation.isPending}>Archive</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
