import type { CaseLogEntry } from '../../types/caseLogEntry';

/**
 * How a Case Log entry reads, shared by the card and its Print view so the
 * two never disagree.
 *
 * 2026-10: a logged call or activity needs a summary; who was contacted is
 * optional, so an unsuccessful call, a voicemail or an internal update can
 * be logged without naming anyone. "Spoke with" is no longer asked for; an
 * entry saved before then still shows the name it recorded.
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

/** Why a new entry cannot be saved, or null when it can. The server
    applies the same rule (app/api/cases/[caseId]/log/route.ts). */
export function caseLogEntryProblem(input: {
  type: CaseLogEntry['type'];
  text?: string;
  contactedWho?: string;
  contactSummary?: string;
}): string | null {
  if (input.type === 'note') return input.text?.trim() ? null : 'A note cannot be empty.';
  if (!input.contactSummary?.trim()) return 'A summary is required.';
  return null;
}
