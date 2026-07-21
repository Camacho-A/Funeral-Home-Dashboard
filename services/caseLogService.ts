import type { OrganizationContext } from '../types/organization';
import type { CaseLogEntry, NewCaseLogEntryInput } from '../types/caseLogEntry';
import { caseLogFixtures } from './__mocks__/fixtures';

export async function list(context: OrganizationContext, caseId: string): Promise<CaseLogEntry[]> {
  return caseLogFixtures.filter((e) => e.organizationId === context.organizationId && e.caseId === caseId);
}

export async function create(
  context: OrganizationContext,
  caseId: string,
  input: NewCaseLogEntryInput,
): Promise<CaseLogEntry> {
  const entry: CaseLogEntry = {
    id: `log-${caseLogFixtures.length + 1}`,
    organizationId: context.organizationId,
    caseId,
    type: input.type,
    text: input.text ?? null,
    contactedWho: input.contactedWho ?? null,
    contactedSpoke: input.contactedSpoke ?? null,
    contactSummary: input.contactSummary ?? null,
    author: input.author,
    createdAt: new Date().toISOString(),
  };
  caseLogFixtures.push(entry);
  return entry;
}

export const caseLogService = { list, create };
