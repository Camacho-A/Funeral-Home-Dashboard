import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseRevision } from '@/lib/wixCaseMapper';
import type { DataAdapterMode } from '@/lib/env';
import type { PaymentStatus } from '@/types/case';

/**
 * Mock mode only (2026-10). Payments, refunds and write-offs always run on
 * the server, which sets the case's stored Payment value itself
 * (services/paymentWorkflow.ts). With real data the case page reads the
 * case back from the server and sees that. In mock mode the browser reads
 * its OWN copy of the case, so the change never showed.
 *
 * This applies exactly the server's change to the browser copy: the
 * server's Payment value is read before and after the action, and only if
 * the action changed it is the new value written locally. A value a staff
 * member set by hand, which the action did not touch, is left alone.
 */
async function readServerPaymentStatus(organizationId: string, caseId: string): Promise<PaymentStatus | null> {
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}?organizationId=${encodeURIComponent(organizationId)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { case?: { paymentStatus?: PaymentStatus } };
    return body.case?.paymentStatus ?? null;
  } catch {
    return null;
  }
}

function applyLocally(organizationId: string, caseId: string, paymentStatus: PaymentStatus): void {
  const index = caseFixtures.findIndex((c) => c.id === caseId && c.organizationId === organizationId);
  if (index === -1 || caseFixtures[index].paymentStatus === paymentStatus) return;
  caseFixtures[index] = { ...caseFixtures[index], paymentStatus, revision: caseRevision(caseFixtures[index]) + 1 };
}

export async function withMockPaymentStatusSync<T>(
  organization: { organizationId: string; dataAdapterMode: DataAdapterMode },
  caseId: string,
  action: () => Promise<T>,
): Promise<T> {
  if (organization.dataAdapterMode !== 'mock') return action();
  const before = await readServerPaymentStatus(organization.organizationId, caseId);
  const result = await action();
  const after = await readServerPaymentStatus(organization.organizationId, caseId);
  if (before !== null && after !== null && before !== after) applyLocally(organization.organizationId, caseId, after);
  return result;
}
