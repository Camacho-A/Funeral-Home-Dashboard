import type { BankAccount } from '../../types/bankAccount';
import type { BankDeposit } from '../../types/bankDeposit';
import type { BankStatementImport, BankStatementLine } from '../../types/bankStatement';
import type { BankReconciliation } from '../../types/bankReconciliation';

/**
 * Phase 31 (Financial Management & General Ledger). Mock-mode, in-process
 * fixtures for the five banking collections — same convention as
 * `services/__mocks__/notificationFixtures.ts`: plain, empty typed arrays,
 * mutated directly by `services/bankingService.ts`'s mock-mode branch,
 * reset between tests by each test file itself (`fixtures.length = 0`),
 * never seeded inside this module.
 */
export const bankAccountFixtures: BankAccount[] = [];
export const bankDepositFixtures: BankDeposit[] = [];
export const bankStatementImportFixtures: BankStatementImport[] = [];
export const bankStatementLineFixtures: BankStatementLine[] = [];
export const bankReconciliationFixtures: BankReconciliation[] = [];
