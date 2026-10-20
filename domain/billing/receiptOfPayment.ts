import type { ProviderIdentity } from './billingModels';
import type { ReceiptFooter } from './organizationStatementOverrides';

/**
 * Receipt of Payment (2026-10) — the family-facing acknowledgement of what
 * was charged and what has been paid, reproducing Manors' own
 * "MANORS RECEIPT OF PAYMENT" document.
 *
 * NOT a replacement for the Statement of Funeral Goods and Services
 * Selected. That statement is a legally mandated FTC disclosure
 * (16 CFR 453.2(b)(5)) with required wording; this is a receipt. They
 * serve different purposes and both exist — see
 * services/billingDocumentService.ts, where each is generated separately
 * under its own document type.
 *
 * Every figure here is READ from the order and the recorded payments.
 * This module computes no money of its own beyond summing what it is
 * given, and nothing in the statement path writes a journal entry.
 */

export type ReceiptPaymentLine = {
  /** "Credit Card", "Check", … — how the family paid. */
  methodLabel: string;
  /** Pre-formatted, e.g. "May 21, 2025". Null when the record carries no
      paid-at instant; never substituted with today. */
  paidAtDisplay: string | null;
  amountCents: number;
};

export type ReceiptLineItem = {
  quantity: number;
  /** The item number column. Null when the catalogue has no code for it —
      shown blank rather than invented. */
  itemNumber: string | null;
  description: string;
  costCents: number;
  discountCents: number;
  totalCents: number;
};

export type ReceiptPaymentStatus = 'paid_in_full' | 'partial_payment' | 'balance_due';

export type ReceiptOfPaymentModel = {
  provider: ProviderIdentity;
  /** Organization-specific footer — Manors names its legal entity; every
      other organization gets one built from its own identity. */
  footer: ReceiptFooter;
  statementDateDisplay: string;
  caseNumber: string;
  /** The responsible family member this receipt is addressed to. Null when
      the case records none — the row then reads "—", never a guess. */
  soldToName: string | null;
  /** Composed through the canonical rule, so the middle name appears here
      exactly as it does everywhere else. */
  deceasedName: string;
  dateOfDeathDisplay: string | null;
  status: ReceiptPaymentStatus;
  /** Set only when fully paid: the date of the LAST payment that cleared
      the balance. Null otherwise. */
  paidInFullDateDisplay: string | null;
  payments: readonly ReceiptPaymentLine[];
  lineItems: readonly ReceiptLineItem[];
  totalChargeCents: number;
  discountCents: number;
  paymentCents: number;
  balanceDueCents: number;
  /** Information the case genuinely does not have. Surfaced to staff
      BEFORE the document is produced rather than silently rendered as a
      blank — "do not invent missing information" is the whole point. */
  missingFields: readonly string[];
};

export const RECEIPT_STATUS_LABEL: Record<ReceiptPaymentStatus, string> = {
  paid_in_full: 'PAID IN FULL',
  partial_payment: 'PARTIAL PAYMENT',
  balance_due: 'BALANCE DUE',
};

/**
 * What the receipt may claim about payment.
 *
 * PAID IN FULL is reachable only when the balance is genuinely zero or
 * less. It is never inferred from "a payment exists", and never from the
 * case's own `paymentStatus` flag — a receipt is a financial assertion to
 * a family, so it follows the money, not a status field somebody may have
 * set by hand.
 */
export function resolveReceiptPaymentStatus(params: {
  balanceDueCents: number;
  paidCents: number;
}): ReceiptPaymentStatus {
  if (params.balanceDueCents <= 0) return 'paid_in_full';
  if (params.paidCents > 0) return 'partial_payment';
  return 'balance_due';
}

/**
 * The date the balance reached zero — the latest payment date, and only
 * when the balance is actually cleared.
 *
 * Returns null for a partially paid or unpaid case, so "PAID IN FULL" and
 * its date can never appear on a receipt that still owes money.
 */
export function resolvePaidInFullDate(
  status: ReceiptPaymentStatus,
  payments: readonly ReceiptPaymentLine[],
): string | null {
  if (status !== 'paid_in_full') return null;
  const dated = payments.map((p) => p.paidAtDisplay).filter((d): d is string => d !== null);
  return dated.length > 0 ? dated[dated.length - 1] : null;
}

/** Integer cents as "$1,234.56" — the receipt's own money format. */
export function formatReceiptMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const body = `$${(abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return negative ? `(${body})` : body;
}

/**
 * "May 21, 2025" from either an ISO instant or a stored "MM/DD/YYYY" date.
 *
 * Returns null rather than guessing when the value is absent or not a
 * date this understands — a receipt must never show a date the record
 * does not actually contain.
 */
export function formatReceiptDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '—') return null;

  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  let year: number;
  let month: number;
  let day: number;
  if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }

  // UTC construction, so the calendar date shown is the one stored —
  // never shifted a day for a viewer behind UTC.
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A family-readable payment method from a stored payment record. */
export function receiptPaymentMethodLabel(params: {
  provider: string;
  cardBrand: string | null;
  cardLast4: string | null;
  /** For a manual entry this is the method staff chose ("Cash",
      "Check — 1234"); see payments/manual/route.ts. */
  receiptReference?: string | null;
}): string {
  const brand = (params.cardBrand ?? '').trim();
  const last4 = (params.cardLast4 ?? '').trim();
  if (brand && last4) return `${brand} ••${last4}`;
  if (brand) return brand;
  // 2026-10: a manual payment printed its provider name, "manual", where
  // the receipt should say how the family paid.
  const reference = (params.receiptReference ?? '').trim();
  if (params.provider.toLowerCase() === 'manual' && reference) return reference;
  // Clover is a card terminal; anything else falls back to its own name
  // rather than being described as something it may not be.
  if (params.provider.toLowerCase() === 'clover') return 'Credit Card';
  return params.provider ? params.provider : 'Payment';
}
