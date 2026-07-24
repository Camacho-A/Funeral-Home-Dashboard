'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { EditServicesModal } from '@/components/case/EditServicesModal';
import { useCaseOrder } from '@/hooks/useCaseOrder';
import { useCasePayments, useCreateCloverCheckout } from '@/hooks/useCasePayments';
import { formatCentsAsCurrency, formatTimestamp } from '@/utils/format';
import { printTextLog } from '@/utils/print';
import {
  PAYMENT_RECORD_STATUS_LABEL,
  paymentRecordStatusVariant,
  caseOrderBalanceStatusLabel,
  caseOrderBalanceStatusVariant,
} from '@/domain/cases/paymentDisplay';
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
  const { data, isPending } = useCaseOrder(caseId);
  const { data: payments = [] } = useCasePayments(caseId);
  const createCheckout = useCreateCloverCheckout(caseId);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [editOpen, setEditOpen] = useState(false);

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

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.title}>Case Order</div>
        {order && (
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
          <div className={styles.actions}>
            <Button onClick={() => setEditOpen(true)}>Set Up Services &amp; Charges</Button>
          </div>
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

          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              Edit Services
            </Button>
            <Button onClick={handleCollect} disabled={!canCollect || createCheckout.isPending}>
              {createCheckout.isPending ? 'Starting checkout…' : 'Collect Balance with Clover'}
            </Button>
            <Button variant="secondary" onClick={handlePrint}>
              Print Order
            </Button>
          </div>
          {createCheckout.isError && (
            <div className={styles.error} role="alert">
              {createCheckout.error instanceof Error ? createCheckout.error.message : 'Failed to start checkout.'}
            </div>
          )}
        </>
      )}

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
              <span className={styles.historyDate}>{formatTimestamp(payment.createdAt)}</span>
              {payment.status === 'failed' && payment.failureMessage && (
                <span className={styles.historyFailure}>{payment.failureMessage}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <EditServicesModal
        caseId={caseId}
        order={order}
        lineItems={lineItems}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
    </div>
  );
}
