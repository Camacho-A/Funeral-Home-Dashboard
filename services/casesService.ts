import type { OrganizationContext } from '../types/organization';
import type { Case, CaseUpdate, NewCaseInput } from '../types/case';
import type { Session } from '../types/session';
import type { WorkflowTemplate } from '../types/workflowTemplate';
import { assertIntakeOwnerUnchanged } from '../domain/cases/intakeOwnership';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '../domain/workflow/snapshot';
import { caseFixtures } from './__mocks__/fixtures';

export type CaseFilters = {
  searchQuery?: string;
};

/**
 * Mock implementation backed by services/__mocks__/fixtures.ts. Every
 * function filters by `context.organizationId` for real — a call with a
 * mismatched organizationId returns empty/not-found rather than assuming
 * isolation, per docs/adr/ADR-002-multi-tenant-architecture.md. Swapping
 * this for real Wix Headless calls later changes only the bodies below —
 * no caller (hooks/services consumers) needs to change.
 */

function matchesSearch(case_: Case, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    case_.decedentName.toLowerCase().includes(q) ||
    case_.nextOfKinPhone.toLowerCase().includes(q) ||
    case_.id.includes(q)
  );
}

export async function list(
  context: OrganizationContext,
  filters: CaseFilters = {},
): Promise<Case[]> {
  return caseFixtures.filter(
    (c) =>
      c.organizationId === context.organizationId &&
      !c.isDeleted &&
      matchesSearch(c, filters.searchQuery ?? ''),
  );
}

export async function get(context: OrganizationContext, caseId: string): Promise<Case | null> {
  const found = caseFixtures.find(
    (c) => c.id === caseId && c.organizationId === context.organizationId && !c.isDeleted,
  );
  return found ?? null;
}

/**
 * `session` and `template` are separate, trusted parameters — never folded
 * into `input` — specifically so `createdBy`/`intakeOwnerId` (from
 * session) and `workflowTemplateId`/`workflowTemplateVersion`/
 * `workflowSnapshot` (from template) can never be supplied by the New Case
 * form. `createdBy`/`intakeOwnerId` are derived from `session.staffId`, the
 * only source of truth for "who is taking this call." `assignedStaffId`
 * also defaults to it (matching design/support.js's `owner: createdBy`)
 * unless the caller explicitly overrides it via `input.assignedStaffId`.
 * `template` is the caller's already-resolved WorkflowTemplate (see
 * hooks/useCreateCase.ts's "workflow selection logic" — which enabled
 * template applies) — this function only snapshots whichever one it's
 * given, it doesn't do the choosing itself.
 */
export async function create(
  context: OrganizationContext,
  input: NewCaseInput,
  session: Session,
  template: WorkflowTemplate,
): Promise<Case> {
  const version = latestTemplateVersion(template);
  const newCase: Case = {
    id: String(1000 + caseFixtures.length + 42), // simple mock id scheme; a real backend assigns this
    organizationId: context.organizationId,
    decedentName: input.decedentName,
    dateOfBirth: input.dateOfBirth ?? '—',
    dateOfDeath: input.dateOfDeath ?? '—',
    timeOfDeath: input.timeOfDeath ?? '—',
    placeOfDeath: input.placeOfDeath ?? '—',
    weight: input.weight ?? '—',
    rawStage: 0,
    assignedStaffId: input.assignedStaffId ?? session.staffId,
    nextOfKinName: input.nextOfKinName,
    nextOfKinPhone: input.nextOfKinPhone,
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    checklistState: {},
    fieldValues: input.fieldValues ?? {},
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: session.staffId,
    intakeOwnerId: session.staffId,
    createdAt: new Date().toISOString(),
    isDeleted: false,
    workflowTemplateId: template.id,
    workflowTemplateVersion: version.version,
    caseType: version.caseTypes[0],
    workflowSnapshot: buildCaseWorkflowSnapshot(template, version),
  };
  caseFixtures.push(newCase);
  return newCase;
}

export async function update(
  context: OrganizationContext,
  caseId: string,
  patch: CaseUpdate,
): Promise<Case> {
  assertIntakeOwnerUnchanged(patch);
  const index = caseFixtures.findIndex(
    (c) => c.id === caseId && c.organizationId === context.organizationId,
  );
  if (index === -1) throw new Error(`Case ${caseId} not found for this organization`);
  const updated = { ...caseFixtures[index], ...patch };
  caseFixtures[index] = updated;
  return updated;
}

export const casesService = { list, get, create, update };
