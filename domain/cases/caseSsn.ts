/**
 * Case SSN (2026-10). The decedent's Social Security number, captured from
 * the case's Arrangement Form (else its Vital Statistics form) and locked:
 * no staff edit, only an administrator's correction with a reason. It
 * feeds the Manatee County application.
 *
 * Stored on the case row as `ssnProtected` — the number encrypted
 * (lib/identity/ssnEncryption.ts) beside its last four digits and its
 * history. Only the summary below ever leaves the server: nobody in SOLIS
 * sees more than •••-••-1234. The full number appears only in a generated
 * Manatee County application.
 */

/** The raw Wix field. Never part of `CaseUpdate`: no case save can set it. */
export const CASE_SSN_RAW_FIELD = 'ssnProtected';

export type CaseSsnSource = 'arrangement_form' | 'vital_statistics' | 'admin_correction';

/** What the case carries — never the number. */
export type CaseSsnSummary = {
  last4: string;
  source: CaseSsnSource;
  capturedAt: string;
  correctedAt: string | null;
};

/** As stored. Server only. */
export type StoredCaseSsn = CaseSsnSummary & {
  ciphertext: string;
  capturedBy: string | null;
  correctedBy: string | null;
  correctionReason: string | null;
};

const SOURCES = new Set<CaseSsnSource>(['arrangement_form', 'vital_statistics', 'admin_correction']);

export function readStoredCaseSsn(raw: unknown): StoredCaseSsn | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ciphertext !== 'string' || !r.ciphertext) return null;
  if (typeof r.last4 !== 'string' || !/^\d{4}$/.test(r.last4)) return null;
  if (typeof r.source !== 'string' || !SOURCES.has(r.source as CaseSsnSource)) return null;
  if (typeof r.capturedAt !== 'string') return null;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    ciphertext: r.ciphertext,
    last4: r.last4,
    source: r.source as CaseSsnSource,
    capturedAt: r.capturedAt,
    capturedBy: text(r.capturedBy),
    correctedAt: text(r.correctedAt),
    correctedBy: text(r.correctedBy),
    correctionReason: text(r.correctionReason),
  };
}

/** The summary the case carries, from the stored field. */
export function caseSsnSummary(raw: unknown): CaseSsnSummary | null {
  const stored = readStoredCaseSsn(raw);
  return stored ? { last4: stored.last4, source: stored.source, capturedAt: stored.capturedAt, correctedAt: stored.correctedAt } : null;
}

export const CASE_SSN_SOURCE_LABEL: Record<CaseSsnSource, string> = {
  arrangement_form: 'From the Arrangement Form',
  vital_statistics: 'From the Vital Statistics form',
  admin_correction: 'Corrected by an administrator',
};

/** Why an administrator corrected it — required, short, never digits. */
export function parseSsnCorrectionReason(value: unknown): string | { error: string } {
  const reason = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (reason.length < 5) return { error: 'Explain why the Social Security number is being corrected.' };
  if (/\d{3}[-\s]?\d{2}[-\s]?\d{4}/.test(reason)) return { error: 'Do not include the number in the reason.' };
  return reason;
}
