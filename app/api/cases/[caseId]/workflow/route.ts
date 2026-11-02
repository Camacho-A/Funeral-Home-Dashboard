import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canEditCase } from '@/services/authorizationPolicyService';
import { applyWorkflowChangeToWixData, caseRevision, changedCaseFields } from '@/lib/wixCaseMapper';
import { CASE_WRITE_MAX_ATTEMPTS, loadCaseRow, writeCaseFields, writeMockCase, type LoadedCaseRow } from '@/services/caseWriteService';
import {
  CASE_REVISION_CONFLICT_MESSAGE,
  CASE_REVISION_CONFLICT_REASON,
  CASE_REVISION_REQUIRED_MESSAGE,
  CASE_REVISION_REQUIRED_REASON,
  CaseRevisionConflictError,
  parseExpectedRevisionValue,
} from '@/domain/cases/caseRevisionConflict';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { listOrganizationWorkflowTemplates } from '@/services/organizationWorkflowTemplates';
import { getServiceCatalog } from '@/services/pricingService';
import { recordWorkflowChanged } from '@/services/activityService';
import { serviceTypeItems } from '@/domain/pricing/calculateOrder';
import { isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';
import { applyWorkflowChangeToCase, planCaseWorkflowChange } from '@/domain/workflow/planCaseWorkflowChange';
import type { Case } from '@/types/case';

/**
 * Service-specific workflows (2026-10). Changes the workflow a case runs
 * on because its service type changed — the ONLY way a case's
 * workflowSnapshot is ever replaced (the generic PATCH allowlist still
 * never accepts workflow fields).
 *
 * Body: { organizationId, serviceTypeCode, expectedWorkflowTemplateId, confirm }.
 *  - confirm !== true: a DRY RUN. Returns the preview staff must see —
 *    completed steps kept, steps not carried over, new requirements, and
 *    the stage the case will land on — and writes nothing.
 *  - confirm === true: re-plans from the freshly loaded case (never trusts
 *    the client's preview), refuses a draft/unknown target (422) or a case
 *    whose workflow moved since the preview (409), then writes the new
 *    snapshot + remapped progress and appends the prior state to
 *    Case.workflowHistory. Nothing is ever deleted.
 *
 * Only for organizations with `features.workflowByServiceType` (403 for
 * everyone else — Manors' cases never change workflow). Permission:
 * `case.update` (canEditCase) — the same permission that governs editing
 * a case's checklist and stage through PATCH, which is exactly what this
 * rewrites; no new permission is invented. Scoped to the caller's own
 * organization: another organization's case is indistinguishable from
 * "not found" (404).
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const correlationId = crypto.randomUUID();
  const { caseId } = await params;

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  if (!isWorkflowByServiceType(organizationId)) {
    return NextResponse.json({ error: 'This organization does not select workflows by service type.' }, { status: 403 });
  }

  const adapter = getDataAdapterMode();
  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, adapter))) {
    return NextResponse.json({ error: 'Not authorized to update this case.' }, { status: 403 });
  }

  if (typeof b.serviceTypeCode !== 'string' || b.serviceTypeCode.trim() === '') {
    return NextResponse.json({ error: 'serviceTypeCode is required.' }, { status: 400 });
  }
  if (typeof b.expectedWorkflowTemplateId !== 'string' || b.expectedWorkflowTemplateId === '') {
    return NextResponse.json({ error: 'expectedWorkflowTemplateId is required.' }, { status: 400 });
  }
  const confirm = b.confirm === true;

  // Case concurrency (2026-10; required to confirm since Phase 5A.1): the
  // revision the preview was computed against (every preview returns it as
  // `caseRevision`). A confirm without it is refused (428); a confirm
  // against a case anyone has changed since is refused (409) — never
  // re-planned behind staff's back. A preview writes nothing and needs none.
  const parsedRevision = parseExpectedRevisionValue(b.expectedRevision);
  if (parsedRevision === 'invalid') {
    return NextResponse.json({ error: 'expectedRevision must be a non-negative integer.' }, { status: 400 });
  }
  if (confirm && parsedRevision === undefined) {
    return NextResponse.json({ error: CASE_REVISION_REQUIRED_MESSAGE, reason: CASE_REVISION_REQUIRED_REASON }, { status: 428 });
  }
  const expectedRevision = parsedRevision;

  try {
    const [templates, catalog] = await Promise.all([
      listOrganizationWorkflowTemplates(organizationId, adapter),
      getServiceCatalog(organizationId, adapter),
    ]);
    const serviceTypes = serviceTypeItems(catalog);

    /**
     * Case concurrency (2026-10). Load → plan → write, as one attempt. The
     * write is FIELD-SCOPED (only the workflow fields the remap changes)
     * and conditional on the case's revision, so a checklist tick or any
     * other write that lands between the load and the write is detected
     * and refused with 409 (Phase 5A.1: the confirm is pinned to its
     * preview's revision; staff preview again). Never a full replace from
     * a stale read (which it used to be, silently discarding such a tick).
     */
    let existing: Case | null = null;
    let plan: Extract<ReturnType<typeof planCaseWorkflowChange>, { ok: true }> | null = null;
    let updated: Case | null = null;
    for (let attempt = 0; attempt < CASE_WRITE_MAX_ATTEMPTS && updated === null; attempt++) {
      // Load the case, scoped to the caller's organization.
      let row: LoadedCaseRow | null = null;
      if (adapter === 'mock') {
        existing = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId) ?? null;
      } else {
        row = await loadCaseRow(organizationId, caseId);
        existing = row?.case_ ?? null;
      }
      if (!existing) {
        return NextResponse.json({ error: `Case ${caseId} not found for this organization` }, { status: 404 });
      }
      if (existing.isDeleted) {
        return NextResponse.json({ error: 'Archived cases are read-only. Restore the case before changing its service.' }, { status: 409 });
      }
      if (expectedRevision !== undefined && caseRevision(existing) !== expectedRevision) {
        return NextResponse.json({ error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: existing }, { status: 409 });
      }

      const planned = planCaseWorkflowChange(
        existing,
        templates,
        { serviceTypeCode: b.serviceTypeCode.trim(), expectedWorkflowTemplateId: b.expectedWorkflowTemplateId },
        {
          activeServiceTypeCodes: serviceTypes.map((item) => item.serviceCode),
          serviceDisplayName: (code) => serviceTypes.find((item) => item.serviceCode === code)?.displayName,
        },
      );
      if (!planned.ok) {
        return NextResponse.json({ error: planned.message, reason: planned.reason }, { status: planned.status });
      }
      plan = planned;
      if (!confirm || planned.write === null) {
        return NextResponse.json({ applied: false, preview: planned.preview, caseRevision: caseRevision(existing) });
      }

      const stamp = { changedAt: new Date().toISOString(), changedByUserId: userId };
      if (adapter === 'mock') {
        try {
          updated = writeMockCase(organizationId, caseId, (current) => applyWorkflowChangeToCase(current, planned.write!, stamp), {
            expectedRevision: caseRevision(existing),
          });
        } catch (error) {
          if (error instanceof CaseRevisionConflictError) {
            return NextResponse.json({ error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: error.current }, { status: 409 });
          }
          throw error;
        }
        break;
      }
      const merged = applyWorkflowChangeToWixData(row!.data, {
        workflowTemplateId: planned.write.workflowTemplateId,
        workflowTemplateVersion: planned.write.workflowTemplateVersion,
        workflowSnapshot: planned.write.workflowSnapshot,
        caseType: planned.write.caseType,
        rawStage: planned.write.rawStage,
        checklistState: planned.write.checklistState,
        fieldValues: planned.write.fieldValues,
        historyEntry: { ...planned.write.previous, ...stamp },
      });
      const written = await writeCaseFields(row!, changedCaseFields(row!.data, merged));
      if (written.result === 'applied') {
        updated = written.case_;
      } else if (written.result === 'conflict') {
        return NextResponse.json({ error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON, case: written.current }, { status: 409 });
      } else if (written.result === 'not_found') {
        return NextResponse.json({ error: `Case ${caseId} not found for this organization` }, { status: 404 });
      } else {
        return NextResponse.json({ error: `The case could not be saved (${written.reason}). Try again.` }, { status: 503 });
      }
    }
    if (!updated || !plan) {
      return NextResponse.json({ error: CASE_REVISION_CONFLICT_MESSAGE, reason: CASE_REVISION_CONFLICT_REASON }, { status: 409 });
    }

    // Best-effort, like every other case activity event — never fails a
    // change that has already been written.
    try {
      await recordWorkflowChanged(
        { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId },
        caseId,
        {
          from: {
            workflowTemplateId: plan.preview.from.workflowTemplateId,
            workflowName: plan.preview.from.workflowName,
            serviceTypeCode: plan.preview.from.serviceTypeCode,
            stage: plan.preview.from.stageLabel,
          },
          to: {
            workflowTemplateId: plan.preview.to.workflowTemplateId,
            workflowName: plan.preview.to.workflowName ?? plan.preview.to.workflowTemplateId,
            serviceTypeCode: plan.preview.to.serviceTypeCode,
            stage: plan.preview.to.stageLabel,
          },
          keptCount: plan.preview.kept.length,
          notCarriedCount: plan.preview.notCarried.length,
          newRequirementCount: plan.preview.newRequirements.length,
        },
        adapter,
      );
    } catch (error) {
      console.error('Failed to record case.workflow.changed activity event:', error instanceof Error ? error.message : error);
    }

    return NextResponse.json({ applied: true, preview: plan.preview, case: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
