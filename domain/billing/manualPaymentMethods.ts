/**
 * Manual payment methods (2026-10). The one list staff choose from in
 * Record a Payment, shared by the form, the client and the server route so
 * they cannot drift.
 *
 * Every method here only RECORDS a payment staff have already collected.
 * "Credit Card" means the family paid by card outside SOLIS (a terminal,
 * a phone payment); SOLIS charges nothing, talks to no processor, and
 * never takes a card number, expiration date or CVV.
 *
 * The chosen label is stored at the start of the payment's
 * `receiptReference` ("Credit Card", "Check — 1042"), which is what the
 * payment history and newly generated receipts print.
 */
export const MANUAL_PAYMENT_METHODS = ['cash', 'check', 'credit_card', 'other'] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export const MANUAL_PAYMENT_METHOD_LABEL: Record<ManualPaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit Card',
  other: 'Other',
};

export function isManualPaymentMethod(value: unknown): value is ManualPaymentMethod {
  return typeof value === 'string' && (MANUAL_PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * Whether a Credit Card payment's optional reference looks like a full
 * card number: 13–19 digits (spaces and dashes ignored) that pass the
 * Luhn check. Deliberately narrow — an approval code, a receipt number or
 * the last four digits are fine — so that a card number typed into the
 * reference by mistake is refused rather than stored and printed.
 */
export function looksLikeCardNumber(reference: string): boolean {
  const digits = reference.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) {
    // A card number embedded in other text is caught too.
    const embedded = reference.match(/\d[\d\s-]{11,22}\d/g) ?? [];
    return embedded.some((candidate) => candidate !== reference && looksLikeCardNumber(candidate));
  }
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
