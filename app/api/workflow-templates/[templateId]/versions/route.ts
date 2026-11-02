import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { insertWixDataItem, WixDataApiError } from '@/lib/wixDataApi';
import {
  fetchWixWorkflowTemplateById,
  buildWixWorkflowTemplateVersionData,
  validateWorkflowStagesPayload,
  validateIntakeTemplatePayload,
} from '@/lib/wixWorkflowTemplateMapper';
import { validateIntakeFields } from '@/domain/workflow/editing';
import { problemMessages, validateWorkflowStages } from '@/domain/workflow/templateValidation';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { currentActorDisplayName } from '@/lib/auth/currentActorDisplayName';
import { canPublishWorkflow } from '@/services/authorizationPolicyService';
import { getServiceCatalog } from '@/services/pricingService';
import { recordWorkflowTemplateVersionSaved } from '@/services/activityService';
import { serviceTypeItems } from '@/domain/pricing/calculateOrder';
import { isWorkflowApprovalRequired, isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';
import { parseCompletionPolicy } from '@/domain/workflow/completionPolicy';
import type { WorkflowCompletionPolicy, WorkflowTemplate, WorkflowTemplateVersion } from '@/types/workflowTemplate';

/**
 * Phase 18 (Workflow Management) / Phase 19 (Configurable Intake Form
 * Builder). Creates a new WorkflowTemplateVersion from an admin's edited
 * `stages` and `intake` — the only write operation either phase adds.
 * Always an INSERT, never an UPDATE: `workflowTemplateVersions` is
 * append-only (docs/WIX_DATA_SCHEMA.md's Collection 4), so "editing a
 * workflow" means "compute the next version number and add a new row,"
 * never touching version 1..N-1. See docs/adr/ADR-019-workflow-management.md
 * and docs/adr/ADR-020-configurable-intake-form-builder.md.
 *
 * `stages` and `intake` are both required in the body — one
 * WorkflowTemplateVersion is one cohesive snapshot of both, the same way
 * buildCaseWorkflowSnapshot always clones both together (never one without
 * the other). The Workflow Editor always submits its full current draft of
 * each; whichever the admin didn't touch this save is simply the same
 * value the form loaded. `caseTypes` still always carries over unchanged
 * from the latest version — neither phase's edit scope touches it.
 *
 * Service-specific completion (2026-10), only for an organization whose
 * versions require approval:
 * - an optional `completionPolicy` (Settings › Workflow Templates'
 *   Completion section) is shape-checked (400) and validated at the
 *   'draft' level with the stages it refers to; omitted, the latest
 *   version's policy carries over unchanged. Any other organization
 *   sending one is refused (400), so their rows keep exactly their shape.
 * - `derivedFrom` (the template a draft was copied from) is NEVER taken
 *   from the request: it carries over from the latest version, so saving
 *   an untouched copy cannot launder it into an "original".
 */
export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { templateId } = await params;

  const body: unknown = await request.json().catch(() => null);
  const requestedOrganizationId =
    body && typeof body === 'object' && typeof (body as Record<string, unknown>).organizationId === 'string'
      ? ((body as Record<string, unknown>).organizationId as string)
      : null;

  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  // Phase 15X pattern: untrusted until re-derived from the caller's own
  // session/membership — never used directly.
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  // Task #11 security follow-up (2026-09): this route previously had no
  // RBAC check at all beyond organization membership — any authenticated
  // staff member could append a new workflow template version. Reuses the
  // existing, already-defined-but-previously-unwired `workflow.publish`
  // permission (see services/authorizationPolicyService.ts's own
  // canPublishWorkflow, and its catalog description "Publish a new
  // workflow template version" — an exact match for what this route
  // does), rather than inventing a new permission. Evaluated for the SAME
  // organization the write is about to target — never a different one —
  // and strictly before any validation/write below.
  const adapter = getDataAdapterMode();
  if (!(await canPublishWorkflow({ identityId: userId, organizationId, roleKey: role }, adapter))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const { stages, errors: stageShapeErrors } = validateWorkflowStagesPayload(body);
  if (!stages) {
    return NextResponse.json({ error: 'Invalid stages payload.', details: stageShapeErrors }, { status: 400 });
  }

  const { intake, errors: intakeShapeErrors } = validateIntakeTemplatePayload(body);
  if (!intake) {
    return NextResponse.json({ error: 'Invalid intake payload.', details: intakeShapeErrors }, { status: 400 });
  }

  // Workflow template editor (2026-10): an optional proposed service
  // assignment, only for an organization that selects workflows by
  // service type. It is stored ON the version and applied to the template
  // when that version is approved (see the approve route), so a draft can
  // never re-route live case creation.
  const rawServiceTypeCodes = (body as Record<string, unknown>).serviceTypeCodes;
  let serviceTypeCodes: string[] | undefined;
  if (rawServiceTypeCodes !== undefined) {
    if (!isWorkflowByServiceType(organizationId)) {
      return NextResponse.json({ error: 'This organization does not assign workflows to service types.' }, { status: 400 });
    }
    if (!Array.isArray(rawServiceTypeCodes) || !rawServiceTypeCodes.every((code) => typeof code === 'string' && code.trim() !== '')) {
      return NextResponse.json({ error: 'serviceTypeCodes must be an array of service type codes.' }, { status: 400 });
    }
    serviceTypeCodes = rawServiceTypeCodes.map((code: string) => code.trim());
  }

  const rawCompletionPolicy = (body as Record<string, unknown>).completionPolicy;
  let completionPolicy: WorkflowCompletionPolicy | undefined;
  if (rawCompletionPolicy !== undefined) {
    if (!isWorkflowApprovalRequired(organizationId)) {
      return NextResponse.json({ error: 'This organization does not configure completion policies.' }, { status: 400 });
    }
    const parsed = parseCompletionPolicy(rawCompletionPolicy);
    if (!parsed.policy) {
      return NextResponse.json({ error: 'Invalid completionPolicy payload.', details: parsed.errors }, { status: 400 });
    }
    completionPolicy = parsed.policy;
  }

  // Server-side authoritative, 'draft' (structural) level — see
  // domain/workflow/templateValidation.ts. Completeness is checked at
  // approval, so a work-in-progress draft can still be saved.
  let activeServiceTypeCodes: string[] | undefined;
  if (serviceTypeCodes) {
    try {
      activeServiceTypeCodes = serviceTypeItems(await getServiceCatalog(organizationId, adapter)).map((item) => item.serviceCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
      return NextResponse.json({ error: message }, { status: 503 });
    }
  }
  const problems = validateWorkflowStages(stages, 'draft', { serviceTypeCodes, activeServiceTypeCodes, completionPolicy });
  if (problems.length > 0) {
    return NextResponse.json({ error: 'Invalid workflow structure.', details: problemMessages(problems), problems }, { status: 400 });
  }

  const intakeErrors = validateIntakeFields(intake);
  if (intakeErrors.length > 0) {
    return NextResponse.json({ error: 'Invalid intake structure.', details: intakeErrors }, { status: 400 });
  }

  const createdByName = await currentActorDisplayName(userId);
  const authorship = { createdBy: userId, ...(createdByName ? { createdByName } : {}) };
  const recordSaved = async (template: WorkflowTemplate, version: number) => {
    // Best-effort, like every other activity event — never fails a version
    // that has already been written.
    try {
      await recordWorkflowTemplateVersionSaved(
        { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
        {
          templateId: template.id,
          templateName: template.name,
          version,
          status: status ?? null,
          serviceTypeCodes: serviceTypeCodes ?? template.serviceTypeCodes ?? null,
        },
        adapter,
      );
    } catch (error) {
      console.error('Failed to record workflow.template.updated activity event:', error instanceof Error ? error.message : error);
    }
  };

  // Service-specific workflows (2026-10): for an organization whose
  // versions require approval, a saved edit is a DRAFT — live cases keep
  // using the latest approved version until an administrator approves
  // this one (POST .../versions/[version]/approve). Everyone else's
  // version rows are written exactly as before (no status at all).
  const status = isWorkflowApprovalRequired(organizationId) ? ('draft' as const) : undefined;

  /** The completion policy (this request's, else the latest version's)
      and the copy source (always the latest version's) — see the header.
      Empty for every version that has neither, so other rows keep their
      exact shape. */
  function carriedCompletionFields(latest: WorkflowTemplateVersion): Pick<WorkflowTemplateVersion, 'completionPolicy' | 'derivedFrom'> {
    const policy = completionPolicy ?? latest.completionPolicy;
    return { ...(policy ? { completionPolicy: policy } : {}), ...(latest.derivedFrom ? { derivedFrom: latest.derivedFrom } : {}) };
  }

  if (adapter === 'mock') {
    const template = workflowTemplateFixtures.find(
      (t) => t.id === templateId && t.organizationId === organizationId,
    );
    if (!template) {
      return NextResponse.json(
        { error: `Workflow template ${templateId} not found for this organization` },
        { status: 404 },
      );
    }

    const latest = template.versions[template.versions.length - 1];
    const newVersion: WorkflowTemplateVersion = {
      version: latest.version + 1,
      caseTypes: latest.caseTypes,
      stages,
      intake,
      createdAt: new Date().toISOString(),
      ...carriedServiceFields(latest),
      ...(status ? { status } : {}),
      ...authorship,
      ...(serviceTypeCodes ? { serviceTypeCodes } : {}),
      ...carriedCompletionFields(latest),
    };
    template.versions.push(newVersion);
    await recordSaved(template, newVersion.version);
    return NextResponse.json({ workflowTemplate: template });
  }

  try {
    const existing = await fetchWixWorkflowTemplateById(organizationId, templateId);
    if (!existing) {
      return NextResponse.json(
        { error: `Workflow template ${templateId} not found for this organization` },
        { status: 404 },
      );
    }

    const latest = existing.versions[existing.versions.length - 1];
    const nextVersionNumber = latest.version + 1;
    const createdAt = new Date().toISOString();

    const carried = carriedCompletionFields(latest);
    const versionData = buildWixWorkflowTemplateVersionData({
      beaconTemplateId: templateId,
      version: nextVersionNumber,
      caseTypes: latest.caseTypes,
      stages,
      intake,
      createdAt,
      ...carriedServiceFields(latest),
      status,
      ...authorship,
      serviceTypeCodes,
      ...carried,
    });

    // Setting the Wix item's own _id to `${templateId}-v${version}` (the
    // same "system id doubles as the natural key" convention Phase 16/16B
    // established for cases/tasks/caseSequences) gives a free collision
    // guard: if two admins somehow save an edit for the same "next
    // version" at once, the loser's insert 409s instead of silently
    // creating two different rows both claiming to be the same version
    // number. This is a best-effort guard, not the full insert-or-retry
    // concurrency machinery Phase 16B built for case numbers — a rare
    // admin-editing collision is lower-stakes than a duplicate legal case
    // number, and is surfaced to the client as a clear 409 to reload and
    // retry rather than resolved automatically. See the ADR's "Known
    // limitations."
    await insertWixDataItem('workflowTemplateVersions', versionData, `${templateId}-v${nextVersionNumber}`);

    const newVersion: WorkflowTemplateVersion = {
      version: nextVersionNumber,
      caseTypes: latest.caseTypes,
      stages,
      intake,
      createdAt,
      ...carriedServiceFields(latest),
      ...(status ? { status } : {}),
      ...authorship,
      ...(serviceTypeCodes ? { serviceTypeCodes } : {}),
      ...carried,
    };
    const workflowTemplate: WorkflowTemplate = {
      ...existing,
      versions: [...existing.versions, newVersion],
    };
    await recordSaved(workflowTemplate, nextVersionNumber);
    return NextResponse.json({ workflowTemplate });
  } catch (error) {
    if (error instanceof WixDataApiError && error.status === 409) {
      return NextResponse.json(
        { error: 'Another edit was saved at the same time. Reload the latest version and try again.' },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

/** Service-based workflows (2026-11): an edit keeps the service(s) and the
    composition the template version serves, so editing a Gus service's
    workflow never takes that service out of New Case. Absent for Manors. */
function carriedServiceFields(latest: WorkflowTemplateVersion): Pick<WorkflowTemplateVersion, 'serviceTypeCodes' | 'composition'> {
  return {
    ...(latest.serviceTypeCodes ? { serviceTypeCodes: [...latest.serviceTypeCodes] } : {}),
    ...(latest.composition ? { composition: structuredClone(latest.composition) } : {}),
  };
}
