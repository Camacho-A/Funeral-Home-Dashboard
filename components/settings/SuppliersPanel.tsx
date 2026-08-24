'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useSuppliers, useCreateSupplier, useArchiveSupplier } from '@/hooks/useProcurement';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
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
      <Card>
        <h2>New supplier</h2>
        <form onSubmit={handleCreate}>
          <TextField placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <TextField placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          <TextField placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <TextField placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <TextField type="number" placeholder="Payment terms (net days)" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })} />
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={createMutation.isPending || form.name.trim().length === 0}>Add supplier</Button>
        </form>
      </Card>

      <Card>
        <h2>Suppliers</h2>
        {suppliers.length === 0 ? (
          <EmptyState message="No suppliers yet — add your first supplier above." />
        ) : (
          <ul>
            {suppliers.map((s) => (
              <li key={s.id}>
                <strong>{s.name}</strong>
                {s.paymentTermsDays != null && <span> — Net {s.paymentTermsDays}</span>}
                {s.email && <span> · {s.email}</span>}{' '}
                <Button type="button" onClick={() => archiveMutation.mutate(s.id)} disabled={archiveMutation.isPending}>Archive</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
