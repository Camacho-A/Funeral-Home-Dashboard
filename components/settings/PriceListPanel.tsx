'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { usePriceLists, useGeneratePriceList } from '@/hooks/useBilling';

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
    <div>
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">General Price List</h2>
        <p className="sx-settings-desc">
          Generate an FTC General Price List from your current catalog. Each version is immutable and records its effective date. Required federal disclosures are system-controlled.
        </p>
      </div>

      <section className="sx-settings-section" aria-labelledby="gpl-heading">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="sx-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <span className="sx-label">Effective date</span>
            <input type="date" className="sx-input" style={{ width: 'auto' }} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </label>
          <button type="button" className="sx-btn sx-btn-primary" onClick={() => generate.mutate(effectiveDate)} disabled={generate.isPending || effectiveDate.length === 0}>
            {generate.isPending ? 'Generating…' : 'Generate Price List'}
          </button>
          {generate.isError && <span className="sx-error">{(generate.error as Error).message}</span>}
        </div>
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Versions</h3>
        {priceLists.isPending && <p className="sx-help">Loading…</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(priceLists.data ?? []).map((doc) => (
            <li key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, minHeight: 36 }}>
              <span className="sx-body" style={{ fontSize: 13.5 }}>
                v{doc.version} · effective {doc.effectiveDate}
                {doc.status !== 'active' && <em className="sx-help"> ({doc.status})</em>}
              </span>
              <a className="sx-link" href={`/api/settings/price-list/${encodeURIComponent(doc.id)}/download?organizationId=${encodeURIComponent(organizationId)}`}>Download</a>
            </li>
          ))}
          {(priceLists.data ?? []).length === 0 && <li className="sx-help" style={{ fontStyle: 'italic' }}>No price lists generated yet.</li>}
        </ul>
      </section>
    </div>
  );
}
