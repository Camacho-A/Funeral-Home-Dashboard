import type { CaseOrder, CaseOrderLineItem } from '../../types/caseOrder';
import type { PaymentRecord, PaymentRecordStatus } from '../../types/payment';
import type { PaymentStatus } from '../../types/case';
import type { CaseTask } from '../../types/task';
import type { LedgerAccount } from '../../types/ledgerAccount';
import { STARTER_CHART_OF_ACCOUNTS } from '../../domain/ledger/starterChartOfAccounts';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';
import { SERVICE_CODES } from '../../domain/pricing/serviceCodes';
import { isSandboxEnabled } from '../../lib/sandbox';

/**
 * SOLIS sandbox examples (2026-10). Fictional payment and task records
 * layered onto the ordinary mock fixtures ONLY when the sandbox switch is
 * on (lib/sandbox.ts) — local development and every test see exactly the
 * fixtures they always did. Every name is one of the existing fictional
 * fixture cases; nothing here resembles a real family or payment.
 *
 * One example per payment state the case page explains:
 *   B2026-001 Robert Ellison  — paid in full (deposit + final payment)
 *   B2026-002 Marie Suarez    — partially paid
 *   B2026-003 Walter Boone    — unpaid
 *   B2026-004 Helen Tran      — paid in full (one card payment)
 *   B2026-005 George Alvarez  — a pending card payment and a failed one, nothing paid
 *   B2026-006 Nancy Whitfield — paid, then refunded: back to awaiting payment
 * B2026-007 and B2026-008 have no Case Order, as older cases don't.
 */

const NOW = '2026-10-26T15:00:00.000Z';
const DIRECT_CREMATION_CENTS = 89_000;

type OrderSeed = { caseId: string; payments: { id: string; status: PaymentRecordStatus; amount: number; card?: boolean }[] };

const ORDER_SEEDS: readonly OrderSeed[] = [
  { caseId: '1042', payments: [{ id: 'deposit', status: 'succeeded', amount: 20_000 }, { id: 'final', status: 'succeeded', amount: 69_000 }] },
  { caseId: '1043', payments: [{ id: 'first', status: 'succeeded', amount: 44_500 }] },
  { caseId: '1044', payments: [] },
  { caseId: '1045', payments: [{ id: 'card', status: 'succeeded', amount: 89_000, card: true }] },
  { caseId: '1046', payments: [{ id: 'failed', status: 'failed', amount: 89_000, card: true }, { id: 'pending', status: 'pending', amount: 89_000, card: true }] },
  { caseId: '1047', payments: [{ id: 'refunded', status: 'refunded', amount: 89_000, card: true }] },
];

/** The stored Payment value each sandbox example starts with, matching its records. */
const PAYMENT_STATUS_OVERRIDES: Readonly<Record<string, PaymentStatus>> = {
  '1043': 'awaiting_payment',
  '1046': 'awaiting_payment',
  '1047': 'awaiting_payment',
};

const orderId = (caseId: string) => `sandbox-order-${caseId}`;

function balanceFor(seed: OrderSeed): number {
  const paid = seed.payments.filter((p) => p.status === 'succeeded').reduce((sum, p) => sum + p.amount, 0);
  return Math.max(DIRECT_CREMATION_CENTS - paid, 0);
}

export function sandboxCaseOrders(): CaseOrder[] {
  if (!isSandboxEnabled()) return [];
  return ORDER_SEEDS.map((seed) => ({
    id: orderId(seed.caseId),
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: seed.caseId,
    status: 'active',
    subtotal: DIRECT_CREMATION_CENTS,
    discountTotal: 0,
    taxTotal: 0,
    total: DIRECT_CREMATION_CENTS,
    balanceDue: balanceFor(seed),
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

export function sandboxCaseOrderLineItems(): CaseOrderLineItem[] {
  if (!isSandboxEnabled()) return [];
  return ORDER_SEEDS.map((seed) => ({
    id: `sandbox-line-${seed.caseId}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseOrderId: orderId(seed.caseId),
    lineKind: 'service',
    serviceCode: SERVICE_CODES.DIRECT_CREMATION,
    description: 'Direct Cremation',
    quantity: 1,
    unitPrice: DIRECT_CREMATION_CENTS,
    lineTotal: DIRECT_CREMATION_CENTS,
    sortOrder: 1,
    metadata: null,
    createdAt: NOW,
  }));
}

export function sandboxPaymentRecords(): PaymentRecord[] {
  if (!isSandboxEnabled()) return [];
  return ORDER_SEEDS.flatMap((seed) =>
    seed.payments.map((p): PaymentRecord => {
      const id = `sandbox-payment-${seed.caseId}-${p.id}`;
      const settled = p.status === 'succeeded' || p.status === 'refunded';
      return {
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: seed.caseId,
        caseOrderId: orderId(seed.caseId),
        provider: p.card ? 'clover' : 'manual',
        providerCheckoutId: p.card ? `sandbox-checkout-${id}` : `manual:${id}`,
        providerPaymentId: p.card && settled ? `sandbox-provider-${id}` : null,
        idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:${id}`,
        checkoutUrl: null,
        status: p.status,
        amount: p.amount,
        currency: 'usd',
        purpose: 'Cremation service fee',
        cardBrand: p.card ? 'VISA' : null,
        cardLast4: p.card ? '4242' : null,
        receiptReference: settled ? `SANDBOX-${seed.caseId}-${p.id.toUpperCase()}` : null,
        failureCode: p.status === 'failed' ? 'card_declined' : null,
        failureMessage: p.status === 'failed' ? 'Card declined (fictional sandbox example)' : null,
        createdAt: NOW,
        paidAt: settled ? NOW : null,
        updatedAt: NOW,
        initiatedByStaffProfileId: 'staff-dana',
        depositedInBankDepositId: null,
      };
    }),
  );
}

/** The starter chart every organization gets at onboarding, so recording a
    payment in the sandbox can post its accounting entry as it does live. */
export function sandboxLedgerAccounts(): LedgerAccount[] {
  if (!isSandboxEnabled()) return [];
  return STARTER_CHART_OF_ACCOUNTS.map((entry) => ({
    id: `sandbox-ledger-account-${entry.accountNumber}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    accountNumber: entry.accountNumber,
    accountNumberKey: `${DEFAULT_ORGANIZATION_ID}:${entry.accountNumber}`,
    name: entry.name,
    accountType: entry.accountType,
    normalBalance: entry.normalBalance,
    parentAccountId: null,
    isSystemAccount: true,
    isActive: true,
    description: entry.description,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

export function sandboxPaymentStatusFor(caseId: string, stored: PaymentStatus): PaymentStatus {
  return isSandboxEnabled() ? (PAYMENT_STATUS_OVERRIDES[caseId] ?? stored) : stored;
}

/** Open and done tasks, mine (Dana), other staff's, and unassigned. */
export function sandboxTasks(): CaseTask[] {
  if (!isSandboxEnabled()) return [];
  const task = (id: string, text: string, assigneeStaffId: string | null, isDone: boolean, caseId: string | null): CaseTask => ({
    id: `sandbox-task-${id}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    text,
    assigneeStaffId,
    isDone,
    caseId,
    dueDate: null,
    createdAt: '10/26/2026',
  });
  return [
    task('1', 'Collect remaining balance — Suarez family', 'staff-dana', false, '1043'),
    task('2', 'Send price list to Boone family', 'staff-chris', false, '1044'),
    task('3', 'Call Alvarez family about the declined card', null, false, '1046'),
    task('4', 'Confirm refund reached the Whitfield family', 'staff-priya', false, '1047'),
    task('5', 'Pick up certified death certificates from the county office', null, false, null),
    task('6', 'Print receipt for the Ellison family', 'staff-dana', true, '1042'),
    task('7', 'Update temporary urn inventory count', 'staff-chris', true, null),
  ];
}
