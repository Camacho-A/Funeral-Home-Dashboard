import type { OrganizationContext } from '../types/organization';
import type { Case, CaseUpdate, NewCaseInput } from '../types/case';
import type { Session } from '../types/session';
import type { WorkflowTemplate } from '../types/workflowTemplate';
import type { DataAdapterMode } from '../lib/env';
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
 * isolation, per docs/adr/ADR-002-multi-tenant-architecture.md.
 *
 * Phase 15C (Wix Case Read Integration): list()/get() gained a
 * `dataAdapterMode` parameter (see docs/adr/ADR-013), read from
 * useOrganization()'s server-resolved value (hooks/useOrganization.tsx),
 * never from a client-side env var read. When it's "mock" (the default,
 * for any caller not yet passing it), this runs the *exact same*
 * fixture-filtering code that ran here before this phase — zero behavior
 * change, no network call, still sharing state with create()/update()
 * below.
 *
 * Phase 16 (Wix Write Integration): create()/update() gained the exact
 * same `dataAdapterMode` parameter, for the exact same reason — see
 * docs/adr/ADR-016. When "mock" (the default), both run the *unchanged*
 * pre-Phase-16 fixture-mutating code below, byte for byte. When "wix",
 * they instead POST/PATCH app/api/cases' Route Handlers, which alone
 * write to Wix and are the only place organizationId is ever re-verified
 * against the caller's session (see
 * lib/auth/requireAuthorizedOrganization.ts) — this service never adds
 * its own authorization logic, it only calls the Route Handler.
 */

export function matchesSearch(case_: Case, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    case_.decedentName.toLowerCase().includes(q) ||
    case_.nextOfKinPhone.toLowerCase().includes(q) ||
    case_.id.includes(q)
  );
}

function listMock(context: OrganizationContext, filters: CaseFilters): Case[] {
  return caseFixtures.filter(
    (c) =>
      c.organizationId === context.organizationId &&
      !c.isDeleted &&
      matchesSearch(c, filters.searchQuery ?? ''),
  );
}

export async function list(
  context: OrganizationContext,
  filters: CaseFilters = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Case[]> {
  if (dataAdapterMode === 'mock') {
    return listMock(context, filters);
  }

  const params = new URLSearchParams({ organizationId: context.organizationId });
  if (filters.searchQuery) params.set('searchQuery', filters.searchQuery);

  const response = await fetch(`/api/cases?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to load cases.');
  }
  const body = (await response.json()) as { cases: Case[] };
  return body.cases;
}

export async function get(
  context: OrganizationContext,
  caseId: string,
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return (
      caseFixtures.find(
        (c) => c.id === caseId && c.organizationId === context.organizationId && !c.isDeleted,
      ) ?? null
    );
  }

  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}?organizationId=${encodeURIComponent(context.organizationId)}`,
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Failed to load case.');
  }
  const body = (await response.json()) as { case: Case | null };
  return body.case;
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
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Case> {
  if (dataAdapterMode === 'wix') {
    const response = await fetch('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: context.organizationId,
        decedentName: input.decedentName,
        nextOfKinName: input.nextOfKinName,
        nextOfKinPhone: input.nextOfKinPhone,
        dateOfBirth: input.dateOfBirth,
        dateOfDeath: input.dateOfDeath,
        timeOfDeath: input.timeOfDeath,
        placeOfDeath: input.placeOfDeath,
        weight: input.weight,
        assignedStaffId: input.assignedStaffId ?? session.staffId,
        fieldValues: input.fieldValues,
        createdBy: session.staffId,
        intakeOwnerId: session.staffId,
      }),
    });
    if (!response.ok) {
      throw new Error('Failed to create case.');
    }
    const body = (await response.json()) as { case: Case };
    return body.case;
  }

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
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<Case> {
  assertIntakeOwnerUnchanged(patch);

  if (dataAdapterMode === 'wix') {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: context.organizationId, patch }),
    });
    if (!response.ok) {
      throw new Error(`Case ${caseId} not found for this organization`);
    }
    const body = (await response.json()) as { case: Case };
    return body.case;
  }

  const index = caseFixtures.findIndex(
    (c) => c.id === caseId && c.organizationId === context.organizationId,
  );
  if (index === -1) throw new Error(`Case ${caseId} not found for this organization`);
  const updated = { ...caseFixtures[index], ...patch };
  caseFixtures[index] = updated;
  return updated;
}

export const casesService = { list, get, create, update };
