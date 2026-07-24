'use client';

import { use, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCasePaymentStatus, useResolveReturnedPayment } from '@/hooks/useCasePayments';
import { Button } from '@/components/ui/Button';
import { PAYMENT_RECORD_STATUS_LABEL } from '@/domain/cases/paymentDisplay';
import styles from './page.module.css';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Where Clover redirects
 * the browser after a Hosted Checkout attempt — for both a completed
 * payment and an explicit cancel. This page's own knowledge of what
 * happened (the `outcome`/`mock` query params) is never treated as
 * authoritative: it only ever displays whatever status is currently
 * stored on the PaymentRecord, confirmed server-side by the webhook (or,
 * in mock mode, by the simulate endpoint standing in for one) — never by
 * the redirect itself. See docs/adr/ADR-022-clover-hosted-checkout-integration.md's
 * "redirect is not authoritative" section.
 *
 * `outcome=cancel` is the one exception allowed to act directly from this
 * page: cancelling makes no claim that a payment succeeded, so there is
 * nothing here that needs webhook confirmation (see the cancel route's
 * own comment).
 */
export default function PaymentReturnPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const paymentId = searchParams.get('paymentId');
  const outcome = searchParams.get('outcome');
  const isMock = searchParams.get('mock') === '1';

  const { cancel, simulateSuccess } = useResolveReturnedPayment(caseId);
  const hasTriggeredRef = useRef(false);

  const { data: payment } = useCasePaymentStatus(caseId, paymentId);

  useEffect(() => {
    if (!paymentId || hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    if (outcome === 'cancel') {
      cancel.mutate(paymentId);
    } else if (isMock) {
      simulateSuccess.mutate(paymentId);
    }
  }, [paymentId, outcome, isMock, cancel, simulateSuccess]);

  if (!paymentId) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>Missing payment reference.</div>
      </div>
    );
  }

  const status = payment?.status ?? 'pending';
  const isConfirming = status === 'pending';

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {isConfirming ? (
          <>
            <div className={styles.title}>Confirming payment…</div>
            <p className={styles.description}>
              Beacon is waiting for Clover to confirm this payment. This updates automatically — no need to refresh.
            </p>
          </>
        ) : (
          <>
            <div className={styles.title}>{PAYMENT_RECORD_STATUS_LABEL[status]}</div>
            {payment?.failureMessage && <p className={styles.description}>{payment.failureMessage}</p>}
          </>
        )}
        <Button onClick={() => router.push(`/cases/${caseId}`)}>Back to case</Button>
      </div>
    </div>
  );
}
