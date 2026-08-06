'use client';

import { use, useState } from 'react';
import { useFamilyPayments, useInitiateFamilyPaymentCheckout } from '@/hooks/useFamilyPortal';
import { FamilyCaseNav } from '@/components/family/FamilyCaseNav';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import styles from '@/components/family/FamilyCaseSection.module.css';

function formatCents(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
}

/**
 * Phase 29 (Family Portal & External Collaboration). The amount charged
 * is always the case's current `CaseOrder.balanceDue`, resolved entirely
 * server-side — this page never computes or displays a balance itself
 * before checkout; it only ever redirects to the provider's own hosted
 * checkout page, which shows the real amount.
 */
export default function FamilyPaymentsPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const paymentsQuery = useFamilyPayments(caseId);
  const initiateCheckout = useInitiateFamilyPaymentCheckout(caseId);
  const [error, setError] = useState<string | null>(null);

  if (paymentsQuery.isPending) return <p className={styles.loading}>Loading payments…</p>;
  if (paymentsQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load payments. Please try again.</p>;

  const payments = paymentsQuery.data ?? [];

  async function handlePayNow() {
    setError(null);
    try {
      const result = await initiateCheckout.mutateAsync(crypto.randomUUID());
      window.location.href = result.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout.');
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Payments</h1>
      <FamilyCaseNav caseId={caseId} />

      {error && <p className={styles.errorText}>{error}</p>}

      <Button onClick={handlePayNow} disabled={initiateCheckout.isPending}>
        {initiateCheckout.isPending ? 'Starting checkout…' : 'Pay Now'}
      </Button>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Payment History</h2>
        {payments.length === 0 ? (
          <EmptyState message="No payments recorded for this case yet." />
        ) : (
          <Card className={styles.listCard}>
            {payments.map((payment) => (
              <div key={payment.id} className={styles.row}>
                <div className={styles.identity}>
                  <span className={styles.title}>
                    {formatCents(payment.amount, payment.currency)} · {payment.purpose}
                  </span>
                  <span className={styles.meta}>
                    {formatTimestamp(payment.createdAt)}
                    {payment.cardBrand && payment.cardLast4 ? ` · ${payment.cardBrand} •••• ${payment.cardLast4}` : ''}
                  </span>
                </div>
                <Badge variant={payment.status === 'succeeded' ? 'success' : payment.status === 'failed' || payment.status === 'cancelled' ? 'danger' : 'brand'}>{payment.status}</Badge>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
