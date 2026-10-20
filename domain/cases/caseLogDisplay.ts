import type { CaseLogEntry } from '../../types/caseLogEntry';

/**
 * How a Case Log entry reads, shared by the card and its Print view so the
 * two never disagree.
 *
 * 2026-10: a logged call records who was contacted and a required summary
 * of the conversation. "Spoke with" is no longer asked for; an entry saved
 * before then still shows the name it recorded.
 */
export function caseLogEntryDisplay(entry: CaseLogEntry): { headline: string | null; body: string | null } {
  if (entry.type === 'contact') {
    const spokeWith = entry.contactedSpoke?.trim();
    return {
      headline: spokeWith ? `Called ${entry.contactedWho} — spoke with ${spokeWith}` : `Called ${entry.contactedWho}`,
      body: entry.contactSummary,
    };
  }
  return { headline: null, body: entry.text };
}

/** Why a new entry cannot be saved, or null when it can. The server
    applies the same rule (app/api/cases/[caseId]/log/route.ts). */
export function caseLogEntryProblem(input: {
  type: CaseLogEntry['type'];
  text?: string;
  contactedWho?: string;
  contactSummary?: string;
}): string | null {
  if (input.type === 'note') return input.text?.trim() ? null : 'A note cannot be empty.';
  if (!input.contactedWho?.trim()) return 'Enter who was contacted.';
  if (!input.contactSummary?.trim()) return 'A summary of the call is required.';
  return null;
}
