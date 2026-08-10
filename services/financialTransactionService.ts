import type { DataAdapterMode } from '../lib/env';
import type { ActivityContext } from './activityService';
import {
  recordJournalEntryPosted,
  recordCaseWriteOffPosted,
  recordFinancialAdjustmentPosted,
  recordBankDepositPosted,
  recordFundsTransferPosted,
  recordPaymentRefunded,
} from './activityService';
import { createAndPostJournalEntry, type NewJournalEntryLineInput } from './generalLedgerService';
import { getAccountByNumber, getAccountById } from './chartOfAccountsService';
import { getPaymentRecordById, updatePaymentRecord, refundPaymentAtProvider } from './paymentsService';
import { refreshBalanceForCase } from './pricingService';
import { queryWixDataItems, insertWixDataItem } from '../lib/wixDataApi';
import { mapWixCaseWriteOffItem, buildWixCaseWriteOffData, type WixCaseWriteOffItem } from '../lib/wixCaseWriteOffMapper';
import { mapWixBankDepositItem, buildWixBankDepositData, type WixBankDepositItem } from '../lib/wixBankDepositMapper';
import { mapWixBankAccountItem, type WixBankAccountItem } from '../lib/wixBankAccountMapper';
import type { CaseWriteOff } from '../types/caseWriteOff';
import type { BankDeposit } from '../types/bankDeposit';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import { caseWriteOffFixtures } from './__mocks__/ledgerFixtures';
import { bankDepositFixtures, bankAccountFixtures } from './__mocks__/bankingFixtures';

/**
 * Phase 31 (Financial Management & General Ledger). One function per
 * financial-transaction type — each a thin caller into
 * `generalLedgerService.createAndPostJournalEntry`, owning its own
 * specific debit/credit account-selection logic. See
 * docs/adr/ADR-035-financial-management-and-general-ledger.md's
 * "Financial transactions and account pairings" section for the exact
 * table this file implements.
 */
export class FinancialTransactionServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

async function requireAccountByNumber(organizationId: string, accountNumber: string, dataAdapterMode: DataAdapterMode) {
  const account = await getAccountByNumber(organizationId, accountNumber, dataAdapterMode);
  if (!account) {
    throw new FinancialTransactionServiceError(
      `Required ledger account "${accountNumber}" does not exist for this organization — has the chart of accounts been seeded?`,
    );
  }
  return account;
}

/**
 * Dr Undeposited Funds / Cr Accounts Receivable — called from
 * `services/paymentWorkflow.ts#markCasePaidIfVerified` right after a
 * payment is verified successful.
 */
export async function postPaymentTransaction(
  organizationId: string,
  params: {
    caseId: string;
    paymentId: string;
    amountCents: number;
    entryDate?: string;
    postedByStaffProfileId?: string | null;
    idFactory: () => string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
) {
  const undepositedFunds = await requireAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, dataAdapterMode);
  const accountsReceivable = await requireAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, dataAdapterMode);

  const { entry } = await createAndPostJournalEntry(
    organizationId,
    {
      entryDate: params.entryDate ?? nowIso(),
      sourceType: 'payment',
      sourceReferenceId: params.paymentId,
      caseId: params.caseId,
      memo: `Payment ${params.paymentId} posted`,
      lines: [
        { accountId: undepositedFunds.id, direction: 'debit', amount: params.amountCents, caseId: params.caseId },
        { accountId: accountsReceivable.id, direction: 'credit', amount: params.amountCents, caseId: params.caseId },
      ],
      postedByStaffProfileId: params.postedByStaffProfileId ?? null,
      idFactory: params.idFactory,
    },
    dataAdapterMode,
  );

  await recordJournalEntryPosted(ctx, params.caseId, entry.id, entry.entryNumber, dataAdapterMode);
  return entry;
}

async function insertCaseWriteOffRow(writeOff: CaseWriteOff, dataAdapterMode: DataAdapterMode): Promise<CaseWriteOff> {
  if (dataAdapterMode === 'mock') {
    caseWriteOffFixtures.push(writeOff);
    return writeOff;
  }
  await insertWixDataItem<WixCaseWriteOffItem>('caseWriteOffs', buildWixCaseWriteOffData(writeOff), writeOff.id);
  return writeOff;
}

/** Every `CaseWriteOff` ever posted for one case — used by callers that
    need the underlying rows themselves (e.g. a future case detail view),
    distinct from `services/pricingService.ts`'s own private read of the
    same collection for its `getSatisfiedAmountForCase` sum (kept separate
    to avoid a circular import between the two services). */
export async function listCaseWriteOffsForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseWriteOff[]> {
  if (dataAdapterMode === 'mock') {
    return caseWriteOffFixtures.filter((w) => w.organizationId === organizationId && w.caseId === caseId);
  }
  const response = await queryWixDataItems<WixCaseWriteOffItem>('caseWriteOffs', { filter: { organizationId, caseId } });
  return response.dataItems.map((item) => mapWixCaseWriteOffItem(item.data)).filter((w): w is CaseWriteOff => w !== null);
}

/**
 * Dr Bad Debt Expense / Cr Accounts Receivable, plus a new, immutable
 * `CaseWriteOff` row — see `services/pricingService.ts#getSatisfiedAmountForCase`
 * for how this keeps `CaseOrder.balanceDue` in sync (conflict #3 in
 * ADR-035). Gated `accounting.manage` at the route layer.
 */
export async function postWriteOffTransaction(
  organizationId: string,
  params: {
    caseId: string;
    amountCents: number;
    reason: string;
    entryDate?: string;
    performedByStaffProfileId?: string | null;
    idFactory: () => string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ writeOff: CaseWriteOff }> {
  const badDebtExpense = await requireAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.BAD_DEBT_EXPENSE, dataAdapterMode);
  const accountsReceivable = await requireAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, dataAdapterMode);
  const now = nowIso();

  const { entry } = await createAndPostJournalEntry(
    organizationId,
    {
      entryDate: params.entryDate ?? now,
      sourceType: 'write_off',
      caseId: params.caseId,
      memo: `Write-off: ${params.reason}`,
      lines: [
        { accountId: badDebtExpense.id, direction: 'debit', amount: params.amountCents, caseId: params.caseId },
        { accountId: accountsReceivable.id, direction: 'credit', amount: params.amountCents, caseId: params.caseId },
      ],
      postedByStaffProfileId: params.performedByStaffProfileId ?? null,
      idFactory: params.idFactory,
      now,
    },
    dataAdapterMode,
  );

  const writeOff = await insertCaseWriteOffRow(
    {
      id: params.idFactory(),
      organizationId,
      caseId: params.caseId,
      amount: params.amountCents,
      journalEntryId: entry.id,
      reason: params.reason,
      performedByStaffProfileId: params.performedByStaffProfileId ?? null,
      createdAt: now,
    },
    dataAdapterMode,
  );

  await recordCaseWriteOffPosted(ctx, params.caseId, writeOff.id, params.amountCents, dataAdapterMode);
  return { writeOff };
}

/**
 * A generic staff-selected debit/credit account pair — the one
 * transaction type with no fixed pairing, for corrections that don't fit
 * the other five (e.g. reclassifying an amount between two expense
 * accounts). Gated `accounting.manage`.
 */
export async function postAdjustmentTransaction(
  organizationId: string,
  params: {
    debitAccountId: string;
    creditAccountId: string;
    amountCents: number;
    memo: string;
    caseId?: string | null;
    entryDate?: string;
    performedByStaffProfileId?: string | null;
    idFactory: () => string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
) {
  const debitAccount = await getAccountById(organizationId, params.debitAccountId, dataAdapterMode);
  if (!debitAccount) throw new FinancialTransactionServiceError(`No ledger account "${params.debitAccountId}" exists in this organization.`);
  const creditAccount = await getAccountById(organizationId, params.creditAccountId, dataAdapterMode);
  if (!creditAccount) throw new FinancialTransactionServiceError(`No ledger account "${params.creditAccountId}" exists in this organization.`);

  const { entry } = await createAndPostJournalEntry(
    organizationId,
    {
      entryDate: params.entryDate ?? nowIso(),
      sourceType: 'adjustment',
      caseId: params.caseId ?? null,
      memo: params.memo,
      lines: [
        { accountId: debitAccount.id, direction: 'debit', amount: params.amountCents, caseId: params.caseId ?? null },
        { accountId: creditAccount.id, direction: 'credit', amount: params.amountCents, caseId: params.caseId ?? null },
      ],
      postedByStaffProfileId: params.performedByStaffProfileId ?? null,
      idFactory: params.idFactory,
    },
    dataAdapterMode,
  );

  await recordFinancialAdjustmentPosted(ctx, params.caseId ?? null, entry.id, params.amountCents, dataAdapterMode);
  return entry;
}

async function insertBankDepositRow(deposit: BankDeposit, dataAdapterMode: DataAdapterMode): Promise<BankDeposit> {
  if (dataAdapterMode === 'mock') {
    bankDepositFixtures.push(deposit);
    return deposit;
  }
  await insertWixDataItem<WixBankDepositItem>('bankDeposits', buildWixBankDepositData(deposit), deposit.id);
  return deposit;
}

/**
 * Dr Cash-Bank / Cr Undeposited Funds, plus a new `BankDeposit` row and
 * marking every included `PaymentRecord.depositedInBankDepositId` — this
 * is what `services/financialTransactionService.ts#postRefundTransaction`
 * later checks to decide which account a refund credits. Rejects any
 * payment id that isn't `succeeded` or is already deposited elsewhere.
 * Gated `accounting.post`.
 */
export async function postDepositTransaction(
  organizationId: string,
  params: {
    bankAccountLedgerAccountId: string;
    paymentIds: string[];
    depositDate?: string;
    memo?: string | null;
    createdByStaffProfileId?: string | null;
    idFactory: () => string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ deposit: BankDeposit }> {
  if (params.paymentIds.length === 0) {
    throw new FinancialTransactionServiceError('A deposit must include at least one payment.');
  }

  let totalAmount = 0;
  for (const paymentId of params.paymentIds) {
    const payment = await getPaymentRecordById(organizationId, paymentId, dataAdapterMode);
    if (!payment) throw new FinancialTransactionServiceError(`No payment "${paymentId}" exists in this organization.`);
    if (payment.status !== 'succeeded') {
      throw new FinancialTransactionServiceError(`Payment "${paymentId}" is not succeeded and cannot be deposited.`);
    }
    if (payment.depositedInBankDepositId) {
      throw new FinancialTransactionServiceError(`Payment "${paymentId}" has already been deposited.`);
    }
    totalAmount += payment.amount;
  }

  const undepositedFunds = await requireAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, dataAdapterMode);
  const bankCashAccount = await getAccountById(organizationId, params.bankAccountLedgerAccountId, dataAdapterMode);
  if (!bankCashAccount) throw new FinancialTransactionServiceError(`No ledger account "${params.bankAccountLedgerAccountId}" exists in this organization.`);

  const now = nowIso();
  const depositId = params.idFactory();
  const { entry } = await createAndPostJournalEntry(
    organizationId,
    {
      entryDate: params.depositDate ?? now,
      sourceType: 'deposit',
      sourceReferenceId: depositId,
      memo: params.memo ?? `Deposit of ${params.paymentIds.length} payment(s)`,
      lines: [
        { accountId: bankCashAccount.id, direction: 'debit', amount: totalAmount },
        { accountId: undepositedFunds.id, direction: 'credit', amount: totalAmount },
      ],
      postedByStaffProfileId: params.createdByStaffProfileId ?? null,
      idFactory: params.idFactory,
      now,
    },
    dataAdapterMode,
  );

  const deposit = await insertBankDepositRow(
    {
      id: depositId,
      organizationId,
      bankAccountId: params.bankAccountLedgerAccountId,
      depositDate: params.depositDate ?? now,
      totalAmount,
      includedPaymentRecordIds: params.paymentIds,
      journalEntryId: entry.id,
      memo: params.memo ?? null,
      createdAt: now,
      createdByStaffProfileId: params.createdByStaffProfileId ?? null,
    },
    dataAdapterMode,
  );

  for (const paymentId of params.paymentIds) {
    await updatePaymentRecord(organizationId, paymentId, { depositedInBankDepositId: deposit.id }, dataAdapterMode);
  }

  await recordBankDepositPosted(ctx, deposit.id, totalAmount, dataAdapterMode);
  return { deposit };
}

/**
 * Dr destination account / Cr source account — a straightforward
 * two-account movement (e.g. moving cash between two bank accounts' own
 * Cash-type ledger accounts). Gated `accounting.post`.
 */
export async function postTransferTransaction(
  organizationId: string,
  params: {
    sourceAccountId: string;
    destinationAccountId: string;
    amountCents: number;
    memo: string;
    entryDate?: string;
    performedByStaffProfileId?: string | null;
    idFactory: () => string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
) {
  const sourceAccount = await getAccountById(organizationId, params.sourceAccountId, dataAdapterMode);
  if (!sourceAccount) throw new FinancialTransactionServiceError(`No ledger account "${params.sourceAccountId}" exists in this organization.`);
  const destinationAccount = await getAccountById(organizationId, params.destinationAccountId, dataAdapterMode);
  if (!destinationAccount) throw new FinancialTransactionServiceError(`No ledger account "${params.destinationAccountId}" exists in this organization.`);

  const { entry } = await createAndPostJournalEntry(
    organizationId,
    {
      entryDate: params.entryDate ?? nowIso(),
      sourceType: 'transfer',
      memo: params.memo,
      lines: [
        { accountId: destinationAccount.id, direction: 'debit', amount: params.amountCents },
        { accountId: sourceAccount.id, direction: 'credit', amount: params.amountCents },
      ],
      postedByStaffProfileId: params.performedByStaffProfileId ?? null,
      idFactory: params.idFactory,
    },
    dataAdapterMode,
  );

  await recordFundsTransferPosted(ctx, entry.id, params.amountCents, dataAdapterMode);
  return entry;
}

export async function getBankDepositById(organizationId: string, depositId: string, dataAdapterMode: DataAdapterMode): Promise<BankDeposit | null> {
  if (dataAdapterMode === 'mock') {
    return bankDepositFixtures.find((d) => d.id === depositId && d.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixBankDepositItem>('bankDeposits', {
    filter: { organizationId, beaconBankDepositId: depositId },
    paging: { limit: 1 },
  });
  return mapWixBankDepositItem(response.dataItems[0]?.data);
}

export async function listBankDepositsForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<BankDeposit[]> {
  if (dataAdapterMode === 'mock') {
    return bankDepositFixtures.filter((d) => d.organizationId === organizationId).sort((a, b) => (a.depositDate < b.depositDate ? 1 : -1));
  }
  const response = await queryWixDataItems<WixBankDepositItem>('bankDeposits', { filter: { organizationId } });
  return response.dataItems
    .map((item) => mapWixBankDepositItem(item.data))
    .filter((d): d is BankDeposit => d !== null)
    .sort((a, b) => (a.depositDate < b.depositDate ? 1 : -1));
}

async function getBankAccountLedgerAccountId(organizationId: string, bankAccountId: string, dataAdapterMode: DataAdapterMode): Promise<string | null> {
  if (dataAdapterMode === 'mock') {
    return bankAccountFixtures.find((a) => a.id === bankAccountId && a.organizationId === organizationId)?.ledgerAccountId ?? null;
  }
  const response = await queryWixDataItems<WixBankAccountItem>('bankAccounts', {
    filter: { organizationId, beaconBankAccountId: bankAccountId },
    paging: { limit: 1 },
  });
  return mapWixBankAccountItem(response.dataItems[0]?.data)?.ledgerAccountId ?? null;
}

/**
 * Dr Accounts Receivable / Cr Undeposited Funds **or** the payment's
 * linked bank Cash account, branching on `PaymentRecord.depositedInBankDepositId`
 * (conflict #4 in ADR-035) — cash already swept into a real bank deposit
 * must come back out of that same Cash account, never out of Undeposited
 * Funds a second time. Calls `PaymentProvider.refundPayment` (via
 * `services/paymentsService.ts#refundPaymentAtProvider`, this file's only
 * point of contact with a payment provider) *before* posting any journal
 * entry, so a provider-side failure never leaves a ledger entry for a
 * refund that didn't actually happen at Clover. Flips
 * `PaymentRecord.status` to 'refunded' and refreshes the case's
 * `CaseOrder.balanceDue` itself (`getPaidAmountForCase` already filters to
 * `'succeeded'` only, so a refunded payment is automatically excluded the
 * next time balance is recomputed — no separate pricing-side code needed).
 * Gated `accounting.post` at the route layer, alongside `payment.refund`.
 */
export async function postRefundTransaction(
  organizationId: string,
  params: {
    caseId: string;
    paymentId: string;
    entryDate?: string;
    postedByStaffProfileId?: string | null;
    idFactory: () => string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
) {
  const payment = await getPaymentRecordById(organizationId, params.paymentId, dataAdapterMode);
  if (!payment) {
    throw new FinancialTransactionServiceError(`No payment "${params.paymentId}" exists in this organization.`);
  }
  if (payment.status !== 'succeeded') {
    throw new FinancialTransactionServiceError(`Payment "${params.paymentId}" is not succeeded and cannot be refunded.`);
  }

  await refundPaymentAtProvider(organizationId, payment, dataAdapterMode);

  const accountsReceivable = await requireAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, dataAdapterMode);

  let creditAccountId: string | null = null;
  if (payment.depositedInBankDepositId) {
    const deposit = await getBankDepositById(organizationId, payment.depositedInBankDepositId, dataAdapterMode);
    if (deposit) {
      creditAccountId = await getBankAccountLedgerAccountId(organizationId, deposit.bankAccountId, dataAdapterMode);
    }
  }
  const creditAccount = creditAccountId
    ? await getAccountById(organizationId, creditAccountId, dataAdapterMode)
    : await requireAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, dataAdapterMode);
  if (!creditAccount) {
    throw new FinancialTransactionServiceError(`Could not resolve a ledger account to credit for this refund.`);
  }

  const { entry } = await createAndPostJournalEntry(
    organizationId,
    {
      entryDate: params.entryDate ?? nowIso(),
      sourceType: 'refund',
      sourceReferenceId: params.paymentId,
      caseId: params.caseId,
      memo: `Refund of payment ${params.paymentId}`,
      lines: [
        { accountId: accountsReceivable.id, direction: 'debit', amount: payment.amount, caseId: params.caseId },
        { accountId: creditAccount.id, direction: 'credit', amount: payment.amount, caseId: params.caseId },
      ],
      postedByStaffProfileId: params.postedByStaffProfileId ?? null,
      idFactory: params.idFactory,
    },
    dataAdapterMode,
  );

  await updatePaymentRecord(organizationId, params.paymentId, { status: 'refunded' }, dataAdapterMode);
  await refreshBalanceForCase(organizationId, params.caseId, dataAdapterMode);
  await recordPaymentRefunded(ctx, params.caseId, params.paymentId, payment.amount, dataAdapterMode);

  return entry;
}

export type { NewJournalEntryLineInput };
