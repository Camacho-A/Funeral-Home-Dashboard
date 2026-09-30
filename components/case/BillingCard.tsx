'use client';

import { useState } from 'react';
import { formatCents } from '@/domain/billing/renderUtil';
import { useOrganization } from '@/hooks/useOrganization';
import { shouldShowCashAdvanceSection } from '@/domain/billing/organizationStatementOverrides';
import { useStatementPreview, useCashAdvances, useCreateCashAdvance, useDeleteCashAdvance, useGenerateStatement } from '@/hooks/useBilling';
import { useCaseDocumentLibrary } from '@/hooks/useCaseDocumentLibrary';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import styles from './BillingCard.module.css';

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
    <section aria-labelledby="billing-heading" className={styles.card}>
      <h2 id="billing-heading" className={styles.heading}>
        Billing &amp; Statement
      </h2>

      {/* Cash advance editor — omitted entirely for an organization that
          doesn't use this workflow (see showCashAdvanceSection above),
          unless the case unexpectedly already has cash advance data (see
          the read-only fallback just below). */}
      {showCashAdvanceSection && (
        <div className={styles.subsection}>
          <h3 className={styles.subsectionTitle}>Cash advance items</h3>
          <p className={styles.subsectionDescription}>
            Third-party items obtained on the family&rsquo;s behalf. These appear on the Statement but are{' '}
            <strong>not</strong> part of the account balance owed to the funeral home.
          </p>
          <ul className={styles.cashAdvanceList}>
            {existingCashAdvances.map((c) => (
              <li key={c.id} className={styles.cashAdvanceRow}>
                <span>
                  {c.description}
                  {c.isEstimated && <em className={styles.estimatedNote}> (estimated)</em>}
                  {c.hasMarkup && <em className={styles.markupNote}> (incl. service charge)</em>}
                </span>
                <span className={styles.cashAdvanceAmountGroup}>
                  <span className={styles.tabularAmount}>{formatCents(c.amountCents)}</span>
                  <button
                    type="button"
                    onClick={() => deleteCa.mutate(c.id)}
                    aria-label={`Remove ${c.description}`}
                    className={styles.removeButton}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
            {existingCashAdvances.length === 0 && <li className={styles.emptyNote}>No cash advance items.</li>}
          </ul>
          <div className={styles.cashAdvanceForm}>
            <TextField
              aria-label="Cash advance description"
              placeholder="Description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className={styles.descriptionField}
            />
            <TextField
              aria-label="Cash advance amount (dollars)"
              placeholder="Amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={styles.amountField}
            />
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={isEstimated} onChange={(e) => setIsEstimated(e.target.checked)} /> Estimate
            </label>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={hasMarkup} onChange={(e) => setHasMarkup(e.target.checked)} /> Has markup
            </label>
            <Button variant="secondary" onClick={addCashAdvance} disabled={createCa.isPending || !desc.trim() || dollarsToCents(amount) === null}>
              Add
            </Button>
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
        <div className={styles.warningBox}>
          <strong className={styles.warningTitle}>Cash advance items on this case</strong>
          <p className={styles.warningText}>
            This organization doesn&rsquo;t use Cash Advance Items in its normal workflow, but this case already has{' '}
            {existingCashAdvances.length} recorded. They remain included in the Statement Total below and are shown here read-only.
          </p>
          <ul className={styles.cashAdvanceList}>
            {existingCashAdvances.map((c) => (
              <li key={c.id} className={styles.cashAdvanceRowReadOnly}>
                <span>{c.description}</span>
                <span className={styles.tabularAmount}>{formatCents(c.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Statement preview with the FTC-total vs AR-balance distinction */}
      <div className={styles.subsection}>
        <h3 className={styles.subsectionTitle}>Statement preview</h3>
        {preview.isPending && <p className={styles.loading}>Loading preview…</p>}
        {preview.isError && (
          <p className={styles.error}>{(preview.error as Error)?.message ?? 'No active order — create an order first.'}</p>
        )}
        {model && (
          <div className={styles.statementBody}>
            <table className={styles.lineItemsTable}>
              <tbody>
                {model.lineItems.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.description}
                      {l.includesBasicServicesFee && <em className={styles.markupNote}> (incl. basic services fee)</em>}
                    </td>
                    <td className={styles.lineItemAmount}>{formatCents(l.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={styles.totalsGrid}>
              <div className={styles.totalBox}>
                <strong>Statement Total</strong>
                <div className={styles.totalCaption}>Goods/services + cash advances</div>
                <div className={styles.totalFigure}>{formatCents(model.ftcStatementTotalCents)}</div>
              </div>
              <div className={`${styles.totalBox} ${styles.totalBoxEmphasis}`}>
                <strong>Account balance due</strong>
                <div className={styles.totalCaption}>Owed to funeral home (cash advances excluded)</div>
                <div className={styles.totalFigure}>{formatCents(model.authoritativeArBalanceDueCents)}</div>
              </div>
            </div>

            <div className={styles.generateRow}>
              <Button onClick={() => generate.mutate({ existingDocumentId: activeStatement?.id })} disabled={generate.isPending}>
                {generate.isPending ? 'Generating…' : activeStatement ? 'Regenerate Statement PDF' : 'Generate Statement PDF'}
              </Button>
              {generate.isError && <span className={styles.generateError}>{(generate.error as Error).message}</span>}
              {generate.isSuccess && <span className={styles.generateSuccess}>Generated — see the Documents tab.</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
