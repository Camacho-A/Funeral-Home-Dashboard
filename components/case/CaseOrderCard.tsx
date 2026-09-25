'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { EditServicesModal } from '@/components/case/EditServicesModal';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useCaseOrder } from '@/hooks/useCaseOrder';
import { useCasePayments, useCreateCloverCheckout, useRecordManualPayment } from '@/hooks/useCasePayments';
import { formatCentsAsCurrency, formatTimestamp } from '@/utils/format';
import { printTextLog } from '@/utils/print';
import {
  PAYMENT_RECORD_STATUS_LABEL,
  paymentRecordStatusVariant,
  caseOrderBalanceStatusLabel,
  caseOrderBalanceStatusVariant,
} from '@/domain/cases/paymentDisplay';
import { additionalItemsLabel } from '@/domain/organization/caseOrderTerminology';
import styles from './CaseOrderCard.module.css';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Replaces
 * components/case/PaymentCard.tsx on Case Detail — "Replace the payment
 * placeholder. Add a 'Case Order' section: Itemized Services; Payments;
 * Balance; Status." The manual amount/purpose entry PaymentCard used to
 * offer is gone entirely: "Collect Balance with Clover" always charges
 * this case's own CaseOrder.balanceDue, computed and enforced server-side
 * (app/api/cases/[caseId]/payments/clover/checkout/route.ts) — there is no
 * amount input anywhere in this component for a reason.
 *
 * Manors launch-prep: three separate, self-gated permission tiers
 * (mirroring RecentActivityPanel's `audit.read` self-gating), not one
 * blanket financial gate — additional case charges (operational add-ons:
 * what services/add-ons are on the order) must stay visible/editable to
 * normal case-working staff even though they don't get financial
 * visibility:
 *   - `caseOrder.read` — the whole card, itemized line items included
 *     (held by every default role that manages cases, e.g. officeStaff).
 *   - `caseOrder.update` — the ability to actually add/edit/remove
 *     services and add-ons ("Edit Services"/"Set Up Services & Charges").
 *   - `payment.read` — the case's TOTAL, balance due, and payment history
 *     specifically (narrower — not every case-working role gets this).
 *   - `payment.collect` — Record Payment / Collect with Clover.
 * Renders nothing at all without `caseOrder.read`. Every query is disabled
 * without its own gate, so no data is fetched for a caller who can't see
 * it — but the real enforcement is server-side (the underlying routes
 * reject an unauthorized caller regardless of what this component renders).
 */
export function CaseOrderCard({
  caseId,
  caseName,
  caseNumber,
}: {
  caseId: string;
  caseName: string;
  caseNumber: string;
}) {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const permissions = permissionsQuery.data?.permissions ?? [];
  const canReadCaseOrder = permissions.includes('caseOrder.read');
  const canEditCaseOrder = permissions.includes('caseOrder.update');
  const canReadPayment = permissions.includes('payment.read');
  const canRecordPayment = permissions.includes('payment.collect');

  const { data, isPending } = useCaseOrder(caseId, canReadCaseOrder);
  const { data: payments = [] } = useCasePayments(caseId, canReadPayment);
  const createCheckout = useCreateCloverCheckout(caseId);
  const recordManualPayment = useRecordManualPayment(caseId);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [editOpen, setEditOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [method, setMethod] = useState<'cash' | 'check' | 'other'>('cash');
  const [amountInput, setAmountInput] = useState('');
  const [reference, setReference] = useState('');

  const order = data?.order ?? null;
  const lineItems = data?.lineItems ?? [];

  const canCollect = Boolean(order) && (order?.balanceDue ?? 0) > 0;

  function handleCollect() {
    if (!canCollect) return;
    createCheckout.mutate(
      { purpose: 'Case order balance due', idempotencyKey },
      {
        onSuccess: ({ checkoutUrl }) => {
          window.location.href = checkoutUrl;
        },
        onSettled: () => setIdempotencyKey(crypto.randomUUID()),
      },
    );
  }

  function dollarsToCents(input: string): number | null {
    const n = Number(input);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }

  function openRecordPayment() {
    setAmountInput(order ? (order.balanceDue / 100).toFixed(2) : '');
    setMethod('cash');
    setReference('');
    setRecordOpen(true);
  }

  function submitManualPayment() {
    const cents = dollarsToCents(amountInput);
    if (cents === null) return;
    recordManualPayment.mutate(
      { method, amountCents: cents, reference: reference.trim() || undefined, idempotencyKey },
      {
        onSuccess: () => {
          setRecordOpen(false);
          setIdempotencyKey(crypto.randomUUID());
        },
      },
    );
  }

  function handlePrint() {
    if (!order) return;
    const rows = [
      ...lineItems.map((item) => ({
        label: item.quantity > 1 ? `${item.description} x${item.quantity}` : item.description,
        amount: formatCentsAsCurrency(item.lineTotal, 'usd'),
        emphasis: false,
      })),
      { label: 'Total', amount: formatCentsAsCurrency(order.total, 'usd'), emphasis: true },
      { label: 'Balance due', amount: formatCentsAsCurrency(order.balanceDue, 'usd'), emphasis: true },
    ];
    printTextLog('Case Order', caseName, caseNumber, rows, (row) => {
      const weight = row.emphasis ? '700' : '400';
      return `<div style="display:flex;justify-content:space-between;font-weight:${weight};margin-bottom:6px"><span>${row.label}</span><span>${row.amount}</span></div>`;
    });
  }

  if (!canReadCaseOrder) return null;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.title}>Case Order</div>
        {order && canReadPayment && (
          <Badge variant={caseOrderBalanceStatusVariant(order.balanceDue)}>
            {caseOrderBalanceStatusLabel(order.balanceDue)}
          </Badge>
        )}
      </div>

      {isPending ? (
        <p className={styles.loading}>Loading…</p>
      ) : !order ? (
        <>
          <EmptyState message="No case order yet." />
          {canEditCaseOrder && (
            <div className={styles.actions}>
              <Button onClick={() => setEditOpen(true)}>Set Up Services &amp; Charges</Button>
            </div>
          )}
        </>
      ) : (
        <>
          <ul className={styles.lineItems}>
            {lineItems.map((item) => (
              <li key={item.id} className={styles.lineItemRow}>
                <span>
                  {item.description}
                  {item.quantity > 1 ? ` x${item.quantity}` : ''}
                </span>
                <span>{formatCentsAsCurrency(item.lineTotal, 'usd')}</span>
              </li>
            ))}
          </ul>

          {canReadPayment && (
            <div className={styles.totalsBlock}>
              <div className={styles.totalRow}>
                <span>Total</span>
                <span>{formatCentsAsCurrency(order.total, 'usd')}</span>
              </div>
              <div className={styles.balanceRow}>
                <span>Balance due</span>
                <span>{formatCentsAsCurrency(order.balanceDue, 'usd')}</span>
              </div>
            </div>
          )}

          <div className={styles.actions}>
            {canEditCaseOrder && (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                {additionalItemsLabel(organizationId)}
              </Button>
            )}
            {canRecordPayment && (
              <Button onClick={handleCollect} disabled={!canCollect || createCheckout.isPending}>
                {createCheckout.isPending ? 'Starting checkout…' : 'Collect Balance with Clover'}
              </Button>
            )}
            {canRecordPayment && (
              <Button variant="secondary" onClick={openRecordPayment} disabled={!canCollect}>
                Record Payment
              </Button>
            )}
            {canReadPayment && (
              <Button variant="secondary" onClick={handlePrint}>
                Print Order
              </Button>
            )}
          </div>
          {createCheckout.isError && (
            <div className={styles.error} role="alert">
              {createCheckout.error instanceof Error ? createCheckout.error.message : 'Failed to start checkout.'}
            </div>
          )}

          {recordOpen && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', border: '1px solid #ddd', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <strong>Record a payment</strong>
              <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>For cash, check, or any payment collected outside Clover.</p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                Method
                <select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'check' | 'other')}>
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                Amount ($)
                <input type="text" inputMode="decimal" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                Reference (optional — e.g. check number)
                <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button onClick={submitManualPayment} disabled={recordManualPayment.isPending || dollarsToCents(amountInput) === null}>
                  {recordManualPayment.isPending ? 'Recording…' : 'Save Payment'}
                </Button>
                <Button variant="secondary" onClick={() => setRecordOpen(false)}>
                  Cancel
                </Button>
              </div>
              {recordManualPayment.isError && (
                <div className={styles.error} role="alert">
                  {recordManualPayment.error instanceof Error ? recordManualPayment.error.message : 'Failed to record payment.'}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {canReadPayment && (
        <>
          <div className={styles.historyTitle}>Payment history</div>
          {payments.length === 0 ? (
            <EmptyState message="No payments recorded yet." />
          ) : (
            <ul className={styles.history}>
              {payments.map((payment) => (
                <li key={payment.id} className={styles.historyRow}>
                  <Badge variant={paymentRecordStatusVariant(payment.status)}>
                    {PAYMENT_RECORD_STATUS_LABEL[payment.status]}
                  </Badge>
                  <span className={styles.historyAmount}>{formatCentsAsCurrency(payment.amount, payment.currency)}</span>
                  <span className={styles.historyPurpose}>{payment.purpose}</span>
                  {payment.cardBrand && payment.cardLast4 && (
                    <span className={styles.historyCard}>
                      {payment.cardBrand} •••• {payment.cardLast4}
                    </span>
                  )}
                  {payment.provider === 'manual' && payment.receiptReference && (
                    <span className={styles.historyCard}>{payment.receiptReference}</span>
                  )}
                  <span className={styles.historyDate}>{formatTimestamp(payment.createdAt)}</span>
                  {payment.status === 'failed' && payment.failureMessage && (
                    <span className={styles.historyFailure}>{payment.failureMessage}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {canEditCaseOrder && (
        <EditServicesModal
          caseId={caseId}
          order={order}
          lineItems={lineItems}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
