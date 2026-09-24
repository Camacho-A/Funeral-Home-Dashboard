import type { OrganizationContext } from '../types/organization';
import type { CaseLogEntry, NewCaseLogEntryInput } from '../types/caseLogEntry';
import { caseLogFixtures } from './__mocks__/fixtures';

/**
 * SOLIS-wide ALL-CAPS data standard (2026-09). CaseLogEntry is currently
 * mock-only — no Wix-backed route/collection exists for it (confirmed by
 * repository search) — so this normalizes the one real write path that
 * exists today without expanding this type's scope into a new production
 * persistence layer. `text`/`contactedWho`/`contactSummary` are
 * staff-entered prose; `author` is the session-derived staff display name
 * and is deliberately never touched here (see the SOLIS ALL-CAPS audit's
 * "staff identity names" exclusion). Apply this same policy at whatever
 * point CaseLogEntry becomes Wix-backed.
 */
function uppercaseIfString(value: string | undefined): string | undefined {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

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
    text: uppercaseIfString(input.text) ?? null,
    contactedWho: uppercaseIfString(input.contactedWho) ?? null,
    contactedSpoke: input.contactedSpoke ?? null,
    contactSummary: uppercaseIfString(input.contactSummary) ?? null,
    author: input.author,
    createdAt: new Date().toISOString(),
  };
  caseLogFixtures.push(entry);
  return entry;
}

export const caseLogService = { list, create };
