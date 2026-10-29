import { parseCaseDate, toCaseDate } from './crematoryPackage';

/**
 * A possible earlier send to the crematory outside SOLIS (2026-10).
 *
 * Workflow 3's "Permit sent to crematory" can be checked by staff for a
 * case SOLIS never sent — the documents may have gone by email, fax or
 * hand before Send to Crematory existed. A checked step never proves an
 * email went out, so it is never taken as a send, nor ignored: staff
 * record what actually happened, once, before the case can be sent.
 */
export type PreviousSendDecision = 'sent_outside_solis' | 'not_previously_sent';

export const PREVIOUS_SEND_METHODS = {
  email: 'Email',
  fax: 'Fax',
  hand_delivery: 'Hand delivery',
  courier: 'Courier',
  crematory_portal: 'Crematory portal',
  other: 'Other',
} as const;
export type PreviousSendMethod = keyof typeof PREVIOUS_SEND_METHODS;

export type PreviousSendInput = {
  decision?: unknown;
  method?: unknown;
  /** YYYY-MM-DD or MM/DD/YYYY; optional ("if known"). */
  sentOn?: unknown;
  /** What staff checked, in their own words. */
  verification?: unknown;
  /** B: staff confirm they checked the sending records. */
  confirmedChecked?: unknown;
};

export type ValidPreviousSend = { decision: PreviousSendDecision; method: PreviousSendMethod | null; sentOn: string | null; verification: string };

const MIN_VERIFICATION = 10;
const MAX_VERIFICATION = 1000;

/** The recorded decision, or why it can't be recorded. `today` is MM/DD/YYYY. */
export function validatePreviousSend(input: PreviousSendInput, today: string): ValidPreviousSend | { error: string } {
  const decision = input.decision;
  if (decision !== 'sent_outside_solis' && decision !== 'not_previously_sent') return { error: 'Choose whether the documents were already sent outside SOLIS.' };
  const verification = typeof input.verification === 'string' ? input.verification.trim().replace(/\s+/g, ' ') : '';
  if (verification.length < MIN_VERIFICATION) {
    return { error: decision === 'sent_outside_solis' ? 'Describe how you verified the earlier send.' : 'Describe which sending records you checked.' };
  }
  if (verification.length > MAX_VERIFICATION) return { error: `Keep the verification under ${MAX_VERIFICATION} characters.` };

  if (decision === 'not_previously_sent') {
    if (input.confirmedChecked !== true) return { error: 'Confirm that you checked the available sending records and the documents were not previously sent.' };
    return { decision, method: null, sentOn: null, verification };
  }

  if (typeof input.method !== 'string' || !(input.method in PREVIOUS_SEND_METHODS)) return { error: 'Choose how the documents were sent.' };
  let sentOn: string | null = null;
  if (typeof input.sentOn === 'string' && input.sentOn.trim()) {
    const raw = input.sentOn.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    sentOn = toCaseDate(iso ? `${iso[2]}/${iso[3]}/${iso[1]}` : raw);
    const parsed = parseCaseDate(sentOn);
    const now = parseCaseDate(today);
    if (!sentOn || !parsed) return { error: 'Enter a valid date for the earlier send, or leave it blank if unknown.' };
    if (now && parsed.year * 10000 + parsed.month * 100 + parsed.day > now.year * 10000 + now.month * 100 + now.day) return { error: 'The earlier send cannot be in the future.' };
  }
  return { decision, method: input.method as PreviousSendMethod, sentOn, verification };
}

/** An administrator's reason for correcting a recorded answer (2026-10). */
export function validateCorrectionReason(reason: unknown): string | { error: string } {
  const text = typeof reason === 'string' ? reason.trim().replace(/\s+/g, ' ') : '';
  if (text.length < MIN_VERIFICATION) return { error: 'Explain why the earlier answer is being corrected.' };
  if (text.length > MAX_VERIFICATION) return { error: `Keep the reason under ${MAX_VERIFICATION} characters.` };
  return text;
}

export function previousSendMethodLabel(method: string | null | undefined): string | null {
  return method && method in PREVIOUS_SEND_METHODS ? PREVIOUS_SEND_METHODS[method as PreviousSendMethod] : null;
}
