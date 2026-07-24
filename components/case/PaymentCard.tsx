'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCasePayments, useCreateCloverCheckout } from '@/hooks/useCasePayments';
import { formatCentsAsCurrency, formatTimestamp } from '@/utils/format';
import { PAYMENT_RECORD_STATUS_LABEL, paymentRecordStatusVariant } from '@/domain/cases/paymentDisplay';
import styles from './PaymentCard.module.css';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Replaces the transient,
 * browser-only raw-card entry that used to live in the New Case form's
 * Payment section (Phase 19A's interim measure, pending a real provider —
 * see that phase's own comment) with real, verified payment collection.
 *
 * Never renders a card number, expiration, or CVV input — "Collect with
 * Clover" only ever starts a redirect to Clover's own hosted page; no
 * payment-instrument data is ever typed into Beacon. See
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md.
 *
 * Supports multiple payments per case by design: the form is always
 * available regardless of payment history (deposits, balances, a failed
 * attempt followed by a retry), never gated on a single "already paid"
 * flag.
 */
export function PaymentCard({ caseId }: { caseId: string }) {
  const { data: payments = [], isPending } = useCasePayments(caseId);
  const createCheckout = useCreateCloverCheckout(caseId);
  const [amountInput, setAmountInput] = useState('');
  const [purpose, setPurpose] = useState('Cremation service fee');

  /**
   * Correction pass (server-side unique-index race guard): a fresh
   * idempotency key is generated once per logical "attempt" and held
   * here — NOT regenerated on every render — so that two requests
   * genuinely representing the same click (a double-click before this
   * button visually disables, or a browser retrying the same in-flight
   * request) carry the identical key and collide on Beacon's server-side
   * unique index rather than silently creating two Clover sessions. A
   * fresh key is drawn only once the current attempt settles
   * (onSettled), so a deliberately new click after that point is treated
   * as a genuinely new attempt. See services/paymentsService.ts's
   * createIdempotentPendingPaymentRecord and
   * docs/adr/ADR-022-clover-hosted-checkout-integration.md.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const hasPending = payments.some((p) => p.status === 'pending');
  const dollars = Number(amountInput);
  const canCollect = amountInput.trim().length > 0 && Number.isFinite(dollars) && dollars > 0 && purpose.trim().length > 0;

  function handleCollect() {
    if (!canCollect) return;
    const amountCents = Math.round(dollars * 100);
    createCheckout.mutate(
      { amount: amountCents, purpose: purpose.trim(), idempotencyKey },
      {
        onSuccess: ({ checkoutUrl }) => {
          // Full browser redirect to Clover's hosted page — never an
          // in-app form. See this component's own top comment.
          window.location.href = checkoutUrl;
        },
        onSettled: () => setIdempotencyKey(crypto.randomUUID()),
      },
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.title}>Payment</div>

      {hasPending && (
        <div className={styles.pendingNotice} role="status">
          A payment is awaiting confirmation.
        </div>
      )}

      <div className={styles.form}>
        <div className={styles.formRow}>
          <TextField
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="Amount due (e.g. 1200.00)"
            aria-label="Amount due"
          />
          <TextField
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Purpose"
            aria-label="Payment purpose"
          />
        </div>
        <Button onClick={handleCollect} disabled={!canCollect || createCheckout.isPending}>
          {createCheckout.isPending ? 'Starting checkout…' : 'Collect with Clover'}
        </Button>
        {createCheckout.isError && (
          <div className={styles.error} role="alert">
            {createCheckout.error instanceof Error ? createCheckout.error.message : 'Failed to start checkout.'}
          </div>
        )}
      </div>

      <div className={styles.historyTitle}>Payment history</div>
      {isPending ? (
        <p className={styles.loading}>Loading…</p>
      ) : payments.length === 0 ? (
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
    </div>
  );
}
