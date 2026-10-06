/**
 * Backs Phase 6's CaseLogCard, via services/caseLogService.ts. Matches
 * docs/CMS_SCHEMA.md's CaseLogEntries collection.
 */
export type CaseLogEntryType = 'note' | 'contact';

export type CaseLogEntry = {
  id: string;
  organizationId: string;
  caseId: string;
  type: CaseLogEntryType;
  text: string | null; // populated when type = 'note'
  contactedWho: string | null; // populated when type = 'contact'
  contactedSpoke: string | null;
  contactSummary: string | null;
  author: string;
  createdAt: string;
};

export type NewCaseLogEntryInput = {
  type: CaseLogEntryType;
  text?: string;
  contactedWho?: string;
  contactedSpoke?: string;
  contactSummary?: string;
  author: string;
};

/**
 * What a Client Component may submit (2026-10): everything except
 * `author`. Attribution is resolved server-side from the authenticated
 * caller's own StaffProfile — see
 * app/api/cases/[caseId]/log/route.ts — so the browser cannot name the
 * author of a log entry, correctly or otherwise.
 */
export type NewCaseLogEntryClientInput = Omit<NewCaseLogEntryInput, 'author'>;
