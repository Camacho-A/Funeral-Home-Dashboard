import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingDocumentServiceError } from './billingDocumentService';
import { regenerateBillingDocuments } from './automaticBillingDocuments';

const { generateStatement, generateReceiptOfPayment, listPaymentRecordsForCase } = vi.hoisted(() => ({
  generateStatement: vi.fn(),
  generateReceiptOfPayment: vi.fn(),
  listPaymentRecordsForCase: vi.fn(),
}));
vi.mock('./billingDocumentService', async () => {
  const actual = await vi.importActual<typeof import('./billingDocumentService')>('./billingDocumentService');
  return { ...actual, generateStatement, generateReceiptOfPayment };
});
vi.mock('./paymentsService', () => ({ listPaymentRecordsForCase }));

const ctx = { organizationId: 'managed-cremations', actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: 'c' };

afterEach(() => vi.clearAllMocks());

describe('regenerateBillingDocuments (automatic Statement and Receipt, 2026-10)', () => {
  it('after a payment, regenerates both', async () => {
    const result = await regenerateBillingDocuments({ caseId: 'case-1', trigger: 'payment_succeeded' }, ctx, 'mock');
    expect(generateStatement).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-1' }), ctx, 'mock');
    expect(generateReceiptOfPayment).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-1' }), ctx, 'mock');
    expect(result).toEqual({ statement: 'generated', receipt: 'generated' });
  });

  it('after an order change with no payment yet, regenerates only the Statement', async () => {
    listPaymentRecordsForCase.mockResolvedValue([{ status: 'pending' }, { status: 'failed' }]);
    const result = await regenerateBillingDocuments({ caseId: 'case-1', trigger: 'order_saved' }, ctx, 'mock');
    expect(generateReceiptOfPayment).not.toHaveBeenCalled();
    expect(result).toEqual({ statement: 'generated', receipt: 'not_applicable' });
  });

  it('after an order change on a case that has been paid, regenerates the Receipt too', async () => {
    listPaymentRecordsForCase.mockResolvedValue([{ status: 'succeeded' }]);
    await regenerateBillingDocuments({ caseId: 'case-1', trigger: 'order_saved' }, ctx, 'mock');
    expect(generateReceiptOfPayment).toHaveBeenCalledTimes(1);
  });

  it('a case with no order yet is not an error — there is simply nothing to print', async () => {
    generateStatement.mockRejectedValueOnce(new BillingDocumentServiceError('This case has no active order'));
    listPaymentRecordsForCase.mockResolvedValue([]);
    const result = await regenerateBillingDocuments({ caseId: 'case-1', trigger: 'order_saved' }, ctx, 'mock');
    expect(result.statement).toBe('not_applicable');
  });

  it('a failed Statement never stops the Receipt, and nothing is thrown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    generateStatement.mockRejectedValueOnce(new Error('renderer unavailable'));
    const result = await regenerateBillingDocuments({ caseId: 'case-1', trigger: 'payment_succeeded' }, ctx, 'mock');
    expect(result).toEqual({ statement: 'failed', receipt: 'generated' });
  });
});
