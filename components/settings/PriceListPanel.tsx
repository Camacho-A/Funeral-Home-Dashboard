'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { usePriceLists, useGeneratePriceList } from '@/hooks/useBilling';
import { Button } from '@/components/ui/Button';

/**
 * Phase 39 (Family Billing & FTC Compliance). Focused Settings panel for the
 * FTC General Price List: generate a new effective-dated version, and list /
 * download prior versions (immutable, provenance-preserving). Not a general
 * compliance console.
 */
export function PriceListPanel() {
  const { organizationId } = useOrganization();
  const priceLists = usePriceLists(organizationId);
  const generate = useGeneratePriceList(organizationId);
  const [effectiveDate, setEffectiveDate] = useState('');

  return (
    <section aria-labelledby="gpl-heading" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h2 id="gpl-heading">General Price List</h2>
      <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
        Generate an FTC General Price List from your current catalog. Each version is immutable and records its effective date. Required federal disclosures are system-controlled.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.85rem' }}>
          Effective date{' '}
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </label>
        <Button onClick={() => generate.mutate(effectiveDate)} disabled={generate.isPending || effectiveDate.length === 0}>
          {generate.isPending ? 'Generating…' : 'Generate Price List'}
        </Button>
        {generate.isError && <span style={{ color: '#a00' }}>{(generate.error as Error).message}</span>}
      </div>

      <div>
        <h3 style={{ marginBottom: '0.5rem' }}>Versions</h3>
        {priceLists.isPending && <p>Loading…</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {(priceLists.data ?? []).map((doc) => (
            <li key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <span>
                v{doc.version} · effective {doc.effectiveDate}
                {doc.status !== 'active' && <em style={{ color: '#777' }}> ({doc.status})</em>}
              </span>
              <a href={`/api/settings/price-list/${encodeURIComponent(doc.id)}/download?organizationId=${encodeURIComponent(organizationId)}`}>Download</a>
            </li>
          ))}
          {(priceLists.data ?? []).length === 0 && <li style={{ color: '#777', fontStyle: 'italic' }}>No price lists generated yet.</li>}
        </ul>
      </div>
    </section>
  );
}
