/**
 * Not consumed by any service or hook yet — built for Phase 6's
 * CaseLogCard. Matches docs/CMS_SCHEMA.md's CaseLogEntries collection.
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
