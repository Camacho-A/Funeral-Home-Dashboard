import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LedgerAccountType, LedgerAccountNormalBalance } from '@/types/ledgerAccount';
import {
  fetchChartOfAccounts,
  createLedgerAccount,
  deactivateLedgerAccount,
  fetchJournalEntries,
  fetchJournalEntryDetail,
  createManualJournalEntry,
  postJournalEntry,
  voidJournalEntry,
  reverseJournalEntry,
  postWriteOff,
  postAdjustment,
  postTransfer,
  refundPayment,
  fetchBankAccounts,
  createBankAccountClient,
  deactivateBankAccountClient,
  fetchBankDeposits,
  createBankDeposit,
  importBankStatementClient,
  fetchStatementImportLines,
  manuallyMatchStatementLineClient,
  excludeStatementLineClient,
  fetchReconciliations,
  startBankReconciliation,
  completeBankReconciliation,
  fetchTrialBalanceReport,
  fetchGeneralLedgerReport,
  fetchBalanceSheetReport,
  fetchProfitAndLossReport,
  fetchArAgingReport,
  fetchTransactionRegisterReport,
} from '@/lib/accountingClient';

/**
 * Phase 31 (Financial Management & General Ledger). Query/mutation hooks
 * for the Accounting subsystem — bundled in one file matching
 * `hooks/useRbac.ts`'s convention (everything sharing this domain's cache
 * entries lives together).
 */

const chartOfAccountsKey = (organizationId: string) => ['accounting', 'chartOfAccounts', organizationId];
const journalEntriesKey = (organizationId: string) => ['accounting', 'journalEntries', organizationId];
const journalEntryKey = (organizationId: string, entryId: string) => ['accounting', 'journalEntry', organizationId, entryId];
const bankAccountsKey = (organizationId: string) => ['accounting', 'bankAccounts', organizationId];
const bankDepositsKey = (organizationId: string) => ['accounting', 'bankDeposits', organizationId];
const statementImportLinesKey = (organizationId: string, importId: string) => ['accounting', 'statementImportLines', organizationId, importId];
const reconciliationsKey = (organizationId: string, bankAccountId: string) => ['accounting', 'reconciliations', organizationId, bankAccountId];

export function useChartOfAccounts(organizationId: string) {
  return useQuery({ queryKey: chartOfAccountsKey(organizationId), queryFn: () => fetchChartOfAccounts(organizationId), enabled: Boolean(organizationId) });
}

export function useCreateLedgerAccount(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      accountNumber: string;
      name: string;
      accountType: LedgerAccountType;
      normalBalance: LedgerAccountNormalBalance;
      parentAccountId?: string | null;
      description?: string | null;
    }) => createLedgerAccount({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chartOfAccountsKey(organizationId) }),
  });
}

export function useDeactivateLedgerAccount(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => deactivateLedgerAccount(organizationId, accountId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chartOfAccountsKey(organizationId) }),
  });
}

export function useJournalEntries(organizationId: string) {
  return useQuery({ queryKey: journalEntriesKey(organizationId), queryFn: () => fetchJournalEntries(organizationId), enabled: Boolean(organizationId) });
}

export function useJournalEntryDetail(organizationId: string, entryId: string | null) {
  return useQuery({
    queryKey: journalEntryKey(organizationId, entryId ?? ''),
    queryFn: () => fetchJournalEntryDetail(organizationId, entryId as string),
    enabled: Boolean(organizationId) && Boolean(entryId),
  });
}

export function useCreateManualJournalEntry(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { entryDate: string; memo: string; lines: Array<{ accountId: string; direction: 'debit' | 'credit'; amount: number }> }) =>
      createManualJournalEntry({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalEntriesKey(organizationId) }),
  });
}

export function usePostJournalEntry(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => postJournalEntry(organizationId, entryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalEntriesKey(organizationId) }),
  });
}

export function useVoidJournalEntry(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => voidJournalEntry(organizationId, entryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalEntriesKey(organizationId) }),
  });
}

export function useReverseJournalEntry(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { entryId: string; reason: string }) => reverseJournalEntry(organizationId, params.entryId, params.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalEntriesKey(organizationId) }),
  });
}

export function usePostWriteOff(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { caseId: string; amountCents: number; reason: string }) => postWriteOff({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalEntriesKey(organizationId) }),
  });
}

export function usePostAdjustment(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { debitAccountId: string; creditAccountId: string; amountCents: number; memo: string; caseId?: string | null }) =>
      postAdjustment({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalEntriesKey(organizationId) }),
  });
}

export function usePostTransfer(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { sourceAccountId: string; destinationAccountId: string; amountCents: number; memo: string }) => postTransfer({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalEntriesKey(organizationId) }),
  });
}

export function useRefundPayment(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { caseId: string; paymentId: string }) => refundPayment(organizationId, params.caseId, params.paymentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalEntriesKey(organizationId) }),
  });
}

export function useBankAccounts(organizationId: string) {
  return useQuery({ queryKey: bankAccountsKey(organizationId), queryFn: () => fetchBankAccounts(organizationId), enabled: Boolean(organizationId) });
}

export function useCreateBankAccount(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string; ledgerAccountId: string; accountNumberLast4?: string | null; bankName?: string | null }) =>
      createBankAccountClient({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bankAccountsKey(organizationId) }),
  });
}

export function useDeactivateBankAccount(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bankAccountId: string) => deactivateBankAccountClient(organizationId, bankAccountId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bankAccountsKey(organizationId) }),
  });
}

export function useBankDeposits(organizationId: string) {
  return useQuery({ queryKey: bankDepositsKey(organizationId), queryFn: () => fetchBankDeposits(organizationId), enabled: Boolean(organizationId) });
}

export function useCreateBankDeposit(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { bankAccountLedgerAccountId: string; paymentIds: string[]; memo?: string | null }) => createBankDeposit({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bankDepositsKey(organizationId) }),
  });
}

export function useImportBankStatement(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { bankAccountId: string; fileName?: string | null; lines: Array<{ transactionDate: string; description: string; amount: number }> }) =>
      importBankStatementClient({ organizationId, ...params }),
    onSuccess: (result) => queryClient.invalidateQueries({ queryKey: statementImportLinesKey(organizationId, result.statementImport.id) }),
  });
}

export function useStatementImportLines(organizationId: string, importId: string | null) {
  return useQuery({
    queryKey: statementImportLinesKey(organizationId, importId ?? ''),
    queryFn: () => fetchStatementImportLines(organizationId, importId as string),
    enabled: Boolean(organizationId) && Boolean(importId),
  });
}

export function useManuallyMatchStatementLine(organizationId: string, importId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { lineId: string; journalEntryId: string }) => manuallyMatchStatementLineClient(organizationId, params.lineId, params.journalEntryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statementImportLinesKey(organizationId, importId) }),
  });
}

export function useExcludeStatementLine(organizationId: string, importId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => excludeStatementLineClient(organizationId, lineId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statementImportLinesKey(organizationId, importId) }),
  });
}

export function useBankReconciliations(organizationId: string, bankAccountId: string | null) {
  return useQuery({
    queryKey: reconciliationsKey(organizationId, bankAccountId ?? ''),
    queryFn: () => fetchReconciliations(organizationId, bankAccountId as string),
    enabled: Boolean(organizationId) && Boolean(bankAccountId),
  });
}

export function useStartBankReconciliation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { bankAccountId: string; statementEndingDate: string; statementEndingBalance: number; bankStatementImportId?: string | null }) =>
      startBankReconciliation({ organizationId, ...params }),
    onSuccess: (result) => queryClient.invalidateQueries({ queryKey: reconciliationsKey(organizationId, result.bankAccountId) }),
  });
}

export function useCompleteBankReconciliation(organizationId: string, bankAccountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reconciliationId: string) => completeBankReconciliation(organizationId, reconciliationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reconciliationsKey(organizationId, bankAccountId) }),
  });
}

export function useTrialBalanceReport(organizationId: string) {
  return useQuery({ queryKey: ['accounting', 'report', 'trialBalance', organizationId], queryFn: () => fetchTrialBalanceReport(organizationId), enabled: Boolean(organizationId) });
}

export function useGeneralLedgerReport(organizationId: string, accountId: string | null) {
  return useQuery({
    queryKey: ['accounting', 'report', 'generalLedger', organizationId, accountId],
    queryFn: () => fetchGeneralLedgerReport(organizationId, accountId as string),
    enabled: Boolean(organizationId) && Boolean(accountId),
  });
}

export function useBalanceSheetReport(organizationId: string) {
  return useQuery({ queryKey: ['accounting', 'report', 'balanceSheet', organizationId], queryFn: () => fetchBalanceSheetReport(organizationId), enabled: Boolean(organizationId) });
}

export function useProfitAndLossReport(organizationId: string) {
  return useQuery({ queryKey: ['accounting', 'report', 'profitAndLoss', organizationId], queryFn: () => fetchProfitAndLossReport(organizationId), enabled: Boolean(organizationId) });
}

export function useArAgingReport(organizationId: string) {
  return useQuery({ queryKey: ['accounting', 'report', 'arAging', organizationId], queryFn: () => fetchArAgingReport(organizationId), enabled: Boolean(organizationId) });
}

export function useTransactionRegisterReport(organizationId: string) {
  return useQuery({ queryKey: ['accounting', 'report', 'transactionRegister', organizationId], queryFn: () => fetchTransactionRegisterReport(organizationId), enabled: Boolean(organizationId) });
}
