/**
 * Backs Phase 6's CaseLogCard, via services/caseLogService.ts. Matches
 * docs/CMS_SCHEMA.md's CaseLogEntries collection.
 */
export type CaseLogEntry = {
  id: string;
  organizationId: string;
  caseId: string;
  type: 'note' | 'contact';
  text: string | null; // populated when type = 'note'
  contactedWho: string | null; // populated when type = 'contact'
  contactedSpoke: string | null;
  contactSummary: string | null;
  author: string;
  createdAt: string;
};

export type NewCaseLogEntryInput = {
  type: 'note' | 'contact';
  text?: string;
  contactedWho?: string;
  contactedSpoke?: string;
  contactSummary?: string;
  author: string;
};
