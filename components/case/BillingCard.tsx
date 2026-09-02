'use client';

import { useState } from 'react';
import { formatCents } from '@/domain/billing/renderUtil';
import { useOrganization } from '@/hooks/useOrganization';
import { useStatementPreview, useCashAdvances, useCreateCashAdvance, useDeleteCashAdvance, useGenerateStatement } from '@/hooks/useBilling';
import { Button } from '@/components/ui/Button';

/**
 * Phase 39 (Family Billing & FTC Compliance). Focused case Billing panel:
 * cash-advance editing, a live preview of the FTC Statement snapshot, and
 * one-click Statement generation. It renders the FTC "total cost of
 * arrangements" and the authoritative AR "balance due" as clearly-distinct
 * figures (cash advances are display-only, never in AR). Generated Statements
 * appear in the case's existing Documents tab (they are CaseDocuments).
 */
function dollarsToCents(input: string): number | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function BillingCard({ caseId }: { caseId: string }) {
  const { organizationId } = useOrganization();
  const preview = useStatementPreview(organizationId, caseId);
  const cashAdvances = useCashAdvances(organizationId, caseId);
  const createCa = useCreateCashAdvance(organizationId, caseId);
  const deleteCa = useDeleteCashAdvance(organizationId, caseId);
  const generate = useGenerateStatement(organizationId, caseId);

  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [isEstimated, setIsEstimated] = useState(false);
  const [hasMarkup, setHasMarkup] = useState(false);

  const model = preview.data;

  async function addCashAdvance() {
    const cents = dollarsToCents(amount);
    if (!desc.trim() || cents === null) return;
    await createCa.mutateAsync({ description: desc.trim(), amountCents: cents, hasMarkup, isEstimated });
    setDesc('');
    setAmount('');
    setIsEstimated(false);
    setHasMarkup(false);
  }

  return (
    <section aria-labelledby="billing-heading" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h2 id="billing-heading">Billing &amp; FTC Statement</h2>

      {/* Cash advance editor */}
      <div>
        <h3 style={{ marginBottom: '0.5rem' }}>Cash advance items</h3>
        <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
          Third-party items obtained on the family&rsquo;s behalf. These appear on the FTC Statement but are <strong>not</strong> part of the account balance owed to the funeral home.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {(cashAdvances.data ?? []).map((c) => (
            <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <span>
                {c.description}
                {c.isEstimated && <em style={{ fontSize: '0.8em', color: '#a60' }}> (estimated)</em>}
                {c.hasMarkup && <em style={{ fontSize: '0.8em', color: '#555' }}> (incl. service charge)</em>}
              </span>
              <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCents(c.amountCents)}</span>
                <button type="button" onClick={() => deleteCa.mutate(c.id)} aria-label={`Remove ${c.description}`} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#a00' }}>
                  ×
                </button>
              </span>
            </li>
          ))}
          {(cashAdvances.data ?? []).length === 0 && <li style={{ color: '#777', fontStyle: 'italic' }}>No cash advance items.</li>}
        </ul>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem', alignItems: 'center' }}>
          <input aria-label="Cash advance description" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <input aria-label="Cash advance amount (dollars)" placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: '6rem' }} />
          <label style={{ fontSize: '0.85rem' }}><input type="checkbox" checked={isEstimated} onChange={(e) => setIsEstimated(e.target.checked)} /> Estimate</label>
          <label style={{ fontSize: '0.85rem' }}><input type="checkbox" checked={hasMarkup} onChange={(e) => setHasMarkup(e.target.checked)} /> Has markup</label>
          <Button variant="secondary" onClick={addCashAdvance} disabled={createCa.isPending || !desc.trim() || dollarsToCents(amount) === null}>Add</Button>
        </div>
      </div>

      {/* Statement preview with the FTC-total vs AR-balance distinction */}
      <div>
        <h3 style={{ marginBottom: '0.5rem' }}>Statement preview</h3>
        {preview.isPending && <p>Loading preview…</p>}
        {preview.isError && <p style={{ color: '#a00' }}>{(preview.error as Error)?.message ?? 'No active order — create an order first.'}</p>}
        {model && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {model.lineItems.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description}{l.includesBasicServicesFee && <em style={{ fontSize: '0.8em', color: '#555' }}> (incl. basic services fee)</em>}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCents(l.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div style={{ border: '1px solid #ccc', borderRadius: 6, padding: '0.5rem' }}>
                <strong>FTC Statement total</strong>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>Goods/services + cash advances</div>
                <div style={{ fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums' }}>{formatCents(model.ftcStatementTotalCents)}</div>
              </div>
              <div style={{ border: '1px solid #ccc', borderRadius: 6, padding: '0.5rem', background: '#f6f6f6' }}>
                <strong>Account balance due</strong>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>Owed to funeral home (cash advances excluded)</div>
                <div style={{ fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums' }}>{formatCents(model.authoritativeArBalanceDueCents)}</div>
              </div>
            </div>

            <div>
              <Button onClick={() => generate.mutate({})} disabled={generate.isPending}>
                {generate.isPending ? 'Generating…' : 'Generate Statement PDF'}
              </Button>
              {generate.isError && <span style={{ color: '#a00', marginLeft: '0.5rem' }}>{(generate.error as Error).message}</span>}
              {generate.isSuccess && <span style={{ color: '#0a0', marginLeft: '0.5rem' }}>Generated — see the Documents tab.</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
