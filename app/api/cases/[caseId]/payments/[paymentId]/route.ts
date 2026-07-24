import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { getEnabledIntegration, getPaymentRecordById, updatePaymentRecord } from '@/services/paymentsService';
import { cloverProvider } from '@/lib/clover/cloverProvider';
import { markCasePaidIfVerified } from '@/services/paymentWorkflow';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Authorized status read
 * for one payment — the return page's polling loop calls this repeatedly
 * via TanStack Query until it sees a terminal status. The browser's own
 * redirect back from Clover is never trusted to mean success; this
 * endpoint's own stored PaymentRecord.status — set authoritatively by the
 * webhook, or (in wix mode) reconciled here as a fallback — is the only
 * source of truth. See docs/adr/ADR-022-clover-hosted-checkout-integration.md's
 * "redirect is not authoritative" section.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string; paymentId: string }> }) {
  const { caseId, paymentId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const dataAdapterMode = getDataAdapterMode();

  let record = await getPaymentRecordById(organizationId, paymentId, dataAdapterMode);
  if (!record || record.caseId !== caseId) {
    return NextResponse.json({ payment: null }, { status: 404 });
  }

  // Fallback reconciliation (wix mode only — mock mode has no real
  // Clover to query; its "pending" records only change via the return
  // page's own simulated-outcome path). Never the primary confirmation
  // path — the webhook is — but this is what lets the return page show a
  // resolved status even if a webhook is delayed or never arrives.
  if (record.status === 'pending' && dataAdapterMode === 'wix') {
    const integration = await getEnabledIntegration(organizationId, record.provider, dataAdapterMode);
    if (integration) {
      try {
        const reconciled = await cloverProvider.getPaymentStatus(integration, record);
        if (reconciled && reconciled.status !== record.status) {
          const nowIso = new Date().toISOString();
          const updated = await updatePaymentRecord(
            organizationId,
            paymentId,
            {
              providerPaymentId: reconciled.providerPaymentId,
              status: reconciled.status,
              cardBrand: reconciled.cardBrand,
              cardLast4: reconciled.cardLast4,
              receiptReference: reconciled.receiptReference,
              failureCode: reconciled.failureCode,
              failureMessage: reconciled.failureMessage,
              paidAt: reconciled.status === 'succeeded' ? nowIso : record.paidAt,
              updatedAt: nowIso,
            },
            dataAdapterMode,
          );
          if (updated) {
            record = updated;
            if (updated.status === 'succeeded') {
              await markCasePaidIfVerified(organizationId, caseId, dataAdapterMode);
            }
          }
        }
      } catch {
        // Best-effort only — a reconciliation failure never surfaces as
        // an error to the caller; the endpoint simply returns whatever
        // status is currently stored, and the webhook remains the
        // authoritative path regardless.
      }
    }
  }

  return NextResponse.json({ payment: record });
}
