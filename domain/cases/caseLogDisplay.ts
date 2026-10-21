import type { CaseLogEntry } from '../../types/caseLogEntry';

/**
 * How a Case Log entry reads, shared by the card and its Print view so the
 * two never disagree.
 *
 * 2026-10: a logged contact needs BOTH who was contacted and a summary (a
 * voicemail still names who was called). "Spoke with" is no longer asked
 * for. Entries saved before either rule still read as they were recorded —
 * one without a contact shows its summary alone; nothing is backfilled.
 */
export function caseLogEntryDisplay(entry: CaseLogEntry): { headline: string | null; body: string | null } {
  if (entry.type === 'contact') {
    const who = entry.contactedWho?.trim();
    const spokeWith = entry.contactedSpoke?.trim();
    return {
      headline: who ? (spokeWith ? `Called ${who} — spoke with ${spokeWith}` : `Called ${who}`) : null,
      body: entry.contactSummary,
    };
  }
  return { headline: null, body: entry.text };
}

export const CONTACTED_REQUIRED_MESSAGE = 'Please enter who was contacted.';
export const SUMMARY_REQUIRED_MESSAGE = 'A summary is required.';

/** Which fields of a contact entry are missing, for inline messages. A
    non-string, blank or whitespace-only value is missing; nothing is ever
    filled in on staff's behalf. */
export function caseLogContactProblems(input: { contactedWho?: unknown; contactSummary?: unknown }): {
  contactedWho?: string;
  contactSummary?: string;
} {
  const filled = (value: unknown) => typeof value === 'string' && value.trim() !== '';
  return {
    ...(filled(input.contactedWho) ? {} : { contactedWho: CONTACTED_REQUIRED_MESSAGE }),
    ...(filled(input.contactSummary) ? {} : { contactSummary: SUMMARY_REQUIRED_MESSAGE }),
  };
}

/** Why an entry cannot be saved, or null when it can. The same rule runs in
    the card, the route (app/api/cases/[caseId]/log/route.ts) and the
    service, so no path can save a contact without who was contacted. */
export function caseLogEntryProblem(input: {
  type: CaseLogEntry['type'];
  text?: unknown;
  contactedWho?: unknown;
  contactSummary?: unknown;
}): string | null {
  if (input.type === 'note') return typeof input.text === 'string' && input.text.trim() ? null : 'A note cannot be empty.';
  const problems = caseLogContactProblems(input);
  return problems.contactedWho ?? problems.contactSummary ?? null;
}
