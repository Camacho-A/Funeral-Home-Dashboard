import type { BankAccount } from '../../types/bankAccount';
import type { BankDeposit } from '../../types/bankDeposit';
import type { BankStatementImport, BankStatementLine } from '../../types/bankStatement';
import type { BankReconciliation } from '../../types/bankReconciliation';
import { mockCollection } from './mockStore';

/**
 * Phase 31 (Financial Management & General Ledger). Mock-mode, in-process
 * fixtures for the five banking collections — same convention as
 * `services/__mocks__/notificationFixtures.ts`: plain, empty typed arrays,
 * mutated directly by `services/bankingService.ts`'s mock-mode branch,
 * reset between tests by each test file itself (`fixtures.length = 0`),
 * never seeded inside this module.
 */
export const bankAccountFixtures: BankAccount[] = mockCollection('bankAccountFixtures', (): BankAccount[] => []);
export const bankDepositFixtures: BankDeposit[] = mockCollection('bankDepositFixtures', (): BankDeposit[] => []);
export const bankStatementImportFixtures: BankStatementImport[] = mockCollection('bankStatementImportFixtures', (): BankStatementImport[] => []);
export const bankStatementLineFixtures: BankStatementLine[] = mockCollection('bankStatementLineFixtures', (): BankStatementLine[] => []);
export const bankReconciliationFixtures: BankReconciliation[] = mockCollection('bankReconciliationFixtures', (): BankReconciliation[] => []);
