'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { shouldShowCashAdvanceSection } from '@/domain/billing/organizationStatementOverrides';
import { useStatementPreview, useCashAdvances, useCreateCashAdvance, useDeleteCashAdvance, useGenerateStatement } from '@/hooks/useBilling';
import { useCaseDocumentLibrary } from '@/hooks/useCaseDocumentLibrary';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import { TextField } from '@/components/ui/TextField';
import styles from './BillingCard.module.css';

/**
 * SOLIS Final Phase §0.5 — display-only currency formatting. The shared
 * `domain/billing/renderUtil.ts#formatCents` stays untouched: both
 * domain/billing/renderGeneralPriceListHtml.ts and
 * domain/billing/renderStatementHtml.ts depend on its exact output for the
 * generated Statement PDF/HTML. This local formatter is for on-screen
 * display only — same numeric output for any amount already covered by
 * this file's own tests (renderUtil's hand-rolled grouping produces the
 * identical string Intl.NumberFormat does), just the standard Intl path
 * per §0.5.
 */
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function formatCents(amount: number): string {
  return currency.format(amount / 100);
}

/**
 * Phase 39 (Family Billing & FTC Compliance). Focused case Billing panel:
 * cash-advance editing, a live preview of the FTC Statement snapshot, and
 * one-click Statement generation. It renders the FTC "total cost of
 * arrangements" and the authoritative AR "balance due" as clearly-distinct
 * figures (cash advances are display-only, never in AR). Generated Statements
 * appear in the case's existing Documents tab (they are CaseDocuments).
 *
 * Item #1 fix (2026-09): reads the same real CaseDocument library the
 * Documents tab does (useCaseDocumentLibrary — never the old, removed,
 * mock-only DocumentsCard/useCaseDocuments) to find this case's current
 * *active* Statement, if any, and passes its id as `existingDocumentId` —
 * the backend already supersedes the prior document and increments the
 * version whenever that's provided; only omitting it (the prior behavior)
 * caused every click to silently create a second, competing "active"
 * Statement instead of replacing the first.
 *
 * Task #14 Phase E (2026-09): presentation rebuilt onto BillingCard.module.css
 * (previously raw inline style={{}} objects and hardcoded hex colors, the
 * single largest visual outlier in the app) — every hook, handler, and
 * mutation call below is byte-for-byte unchanged from before this phase.
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
  const documents = useCaseDocumentLibrary(organizationId, caseId);
  const activeStatement =
    documents.data?.find(
      (d) => d.documentTypeKey === DOCUMENT_TYPES.FINANCIAL_STATEMENT_GOODS_SERVICES.key && d.status === 'active',
    ) ?? null;

  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [isEstimated, setIsEstimated] = useState(false);
  const [hasMarkup, setHasMarkup] = useState(false);

  const model = preview.data;

  // Item #11 (2026-09, Manors billing cleanup). Reuses the same
  // organization-aware capability the FTC Statement already uses
  // (organizationStatementOverrides.ts) so the Billing UI and the
  // generated Statement never disagree about whether this organization
  // uses the Cash Advance workflow. Manors uses Case Order/Additional
  // Items & Services instead (see domain/organization/caseOrderTerminology.ts)
  // and never sees this editor in its normal workflow. No new
  // capability/feature flag introduced — this is the one existing,
  // centralized mechanism already governing the same distinction.
  const showCashAdvanceSection = shouldShowCashAdvanceSection(organizationId);
  const existingCashAdvances = cashAdvances.data ?? [];
  // An organization that suppresses this section is only ever expected to
  // have zero cash advance items (mirrors renderStatementHtml.ts's own
  // reconciliation guard, which refuses to render a Statement in this same
  // situation). If a case somehow has some anyway, the "FTC Statement
  // total" below already silently includes that amount — so rather than
  // concealing money that's part of a displayed total, or resurrecting the
  // full add/delete editor for an organization that shouldn't be using it,
  // show a read-only, no-further-editing indication instead.
  const hasUnexpectedCashAdvances = !showCashAdvanceSection && existingCashAdvances.length > 0;

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
    <section aria-labelledby="billing-heading" className="sx-bill">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 id="billing-heading" style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
            Billing &amp; Statement
          </h2>
          {/* SOLIS Final Phase §8.2's literal copy says "FTC Statement" —
              deliberately not reproduced verbatim: a prior, documented
              decision (see this file's own test describe block "staff-
              facing 'FTC Statement' simplified to 'Statement'") removed
              that term from every staff-facing string here. Kept the
              description, dropped "FTC". */}
          <p className="sx-page-desc" style={{ marginTop: 2 }}>
            Live preview of the Statement for this case.
          </p>
        </div>
        {model && (
          <button type="button" className={`sx-btn sx-btn-primary ${styles.billingHeaderAction}`} onClick={() => generate.mutate({ existingDocumentId: activeStatement?.id })} disabled={generate.isPending}>
            {generate.isPending ? 'Generating…' : activeStatement ? 'Regenerate Statement PDF' : 'Generate Statement PDF'}
          </button>
        )}
      </div>

      {/* Cash advance editor — omitted entirely for an organization that
          doesn't use this workflow (see showCashAdvanceSection above),
          unless the case unexpectedly already has cash advance data (see
          the read-only fallback just below). */}
      {showCashAdvanceSection && (
        <div className={styles.subsection}>
          <h3 className="sx-section-title">Cash advance items</h3>
          <p className="sx-help">
            Third-party items obtained on the family&rsquo;s behalf. These appear on the Statement but are{' '}
            <strong>not</strong> part of the account balance owed to the funeral home.
          </p>
          <table className="sx-table">
            <tbody>
              {existingCashAdvances.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.description}
                    {c.isEstimated && <span className="sx-cell-sub"> (estimated)</span>}
                    {c.hasMarkup && <span className="sx-cell-sub"> (incl. service charge)</span>}
                  </td>
                  <td className="sx-num">{formatCents(c.amountCents)}</td>
                  <td style={{ width: 48 }}>
                    <div className="sx-row-actions">
                      <button type="button" onClick={() => deleteCa.mutate(c.id)} aria-label={`Remove ${c.description}`} className="sx-icon-btn">
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {existingCashAdvances.length === 0 && <div className="sx-empty-text">No cash advance items.</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
            <TextField
              aria-label="Cash advance description"
              placeholder="Description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="sx-input"
              style={{ flex: 1, minWidth: 200 }}
            />
            <TextField
              aria-label="Cash advance amount (dollars)"
              placeholder="Amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="sx-input"
              style={{ width: 120, textAlign: 'right' }}
            />
            <label className="sx-check">
              <input type="checkbox" checked={isEstimated} onChange={(e) => setIsEstimated(e.target.checked)} /> Estimate
            </label>
            <label className="sx-check">
              <input type="checkbox" checked={hasMarkup} onChange={(e) => setHasMarkup(e.target.checked)} /> Has markup
            </label>
            <button type="button" className="sx-btn sx-btn-secondary" onClick={addCashAdvance} disabled={createCa.isPending || !desc.trim() || dollarsToCents(amount) === null}>
              Add
            </button>
          </div>
        </div>
      )}

      {/* Data-safety fallback (item #11): this organization doesn't use
          Cash Advance Items, but this particular case unexpectedly has
          some already recorded. They're never deleted or hidden — shown
          read-only so the FTC Statement total above stays reconciled with
          what's visibly displayed. No add/delete controls are offered,
          since this organization's normal workflow doesn't use this
          mechanism at all. */}
      {hasUnexpectedCashAdvances && (
        <div className="sx-form-banner" style={{ background: 'var(--sx-amber-bg)', border: '1px solid oklch(0.88 0.06 75)', color: 'var(--sx-amber-text)', flexDirection: 'column' }}>
          <strong>Cash advance items on this case</strong>
          <p>
            This organization doesn&rsquo;t use Cash Advance Items in its normal workflow, but this case already has{' '}
            {existingCashAdvances.length} recorded. They remain included in the Statement Total below and are shown here read-only.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {existingCashAdvances.map((c) => (
              <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>{c.description}</span>
                <span className="sx-num">{formatCents(c.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Statement preview with the FTC-total vs AR-balance distinction */}
      <div className={styles.subsection}>
        {preview.isPending && (
          <div className="sx-loading" aria-busy="true">
            <span className="sx-skeleton" style={{ width: '90%' }} />
            <span className="sx-skeleton" style={{ width: '70%' }} />
            <span className="sx-skeleton" style={{ width: '80%' }} />
            <span className="sr-only">Loading preview…</span>
          </div>
        )}
        {preview.isError && (
          <div className="sx-form-banner sx-form-banner-info">{(preview.error as Error)?.message ?? 'No active order — create an order first.'}</div>
        )}
        {model && (
          <div className={styles.statementBody}>
            <div className="sx-kpis" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
              <div className="sx-kpi">
                <span className="sx-kpi-label">Statement Total</span>
                <span className="sx-kpi-value">{formatCents(model.ftcStatementTotalCents)}</span>
                <span className="sx-kpi-caption">Goods/services + cash advances</span>
              </div>
              <div className="sx-kpi sx-kpi-emph">
                <span className="sx-kpi-label">Account balance due</span>
                <span className="sx-kpi-value">{formatCents(model.authoritativeArBalanceDueCents)}</span>
                <span className="sx-kpi-caption">Owed to funeral home (cash advances excluded)</span>
              </div>
            </div>

            <h3 className="sx-section-title">
              Statement line items<span className="sx-section-meta">{model.lineItems.length} items</span>
            </h3>
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="sx-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {model.lineItems.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.description}
                      {l.includesBasicServicesFee && <span className="sx-cell-sub"> (incl. basic services fee)</span>}
                    </td>
                    <td className="sx-num">{formatCents(l.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Statement total</td>
                  <td className="sx-num">{formatCents(model.ftcStatementTotalCents)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="sx-bill-actions">
              {generate.isSuccess && <span className="sx-bill-success">✓ Generated — see the Documents tab.</span>}
              {generate.isError && <span className="sx-bill-err">{(generate.error as Error).message}</span>}
              <span className="sx-bill-note">Statements are saved as case documents.</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
