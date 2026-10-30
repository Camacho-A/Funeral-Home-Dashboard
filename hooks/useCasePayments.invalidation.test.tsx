import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateCasePaymentState } from './useCasePayments';

/**
 * Recording a payment (2026-10): the server marks the case "Paid in full"
 * when a verified payment clears the balance, so the case itself must be
 * read again — not only the payment list and the Case Order — or the
 * Case Information "Payment" field stays stale until a reload.
 */
describe('invalidateCasePaymentState', () => {
  it('refreshes the payments, the Case Order and the case — for this case only', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateCasePaymentState(queryClient, 'org-1', 'case-1');
    const keys = spy.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([
      ['casePayments', 'org-1', 'case-1'],
      ['caseOrder', 'org-1', 'case-1'],
      ['case', 'org-1', 'case-1'],
    ]);
  });
});
