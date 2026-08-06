'use client';

import { use, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFamilyPaymentStatus, useResolveReturnedFamilyPayment } from '@/hooks/useFamilyPortal';
import { Button } from '@/components/ui/Button';
import styles from './page.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). Mirrors the staff
 * `app/(portal)/cases/[caseId]/payments/return/page.tsx`'s exact
 * discipline: the `outcome`/`mock` query params are never treated as
 * authoritative — only the `PaymentRecord`'s own current status is ever
 * displayed, confirmed server-side (by the real Clover webhook, or the
 * mock-mode simulate route standing in for one).
 */
function FamilyPaymentReturnContent({ caseId }: { caseId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const paymentId = searchParams.get('paymentId');
  const outcome = searchParams.get('outcome');
  const isMock = searchParams.get('mock') === '1';

  const { cancel, simulateSuccess } = useResolveReturnedFamilyPayment(caseId);
  const hasTriggeredRef = useRef(false);

  const { data: payment } = useFamilyPaymentStatus(caseId, paymentId);

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
            <p className={styles.description}>This updates automatically — no need to refresh.</p>
          </>
        ) : (
          <div className={styles.title}>{status === 'succeeded' ? 'Payment received' : status === 'cancelled' ? 'Payment cancelled' : 'Payment failed'}</div>
        )}
        <Button onClick={() => router.push(`/family/cases/${caseId}/payments`)}>Back to Payments</Button>
      </div>
    </div>
  );
}

export default function FamilyPaymentReturnPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  return (
    <Suspense>
      <FamilyPaymentReturnContent caseId={caseId} />
    </Suspense>
  );
}
