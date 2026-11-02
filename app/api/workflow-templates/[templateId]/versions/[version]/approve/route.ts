import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { conditionalPatchWixDataItem, conditionalPatchWixDataItemFields, queryWixDataItems } from '@/lib/wixDataApi';
import {
  buildWixWorkflowTemplateVersionApprovalFields,
  fetchWixWorkflowTemplateById,
  fetchWixWorkflowTemplates,
  type WixWorkflowTemplateItem,
  type WixWorkflowTemplateVersionItem,
} from '@/lib/wixWorkflowTemplateMapper';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { currentActorDisplayName } from '@/lib/auth/currentActorDisplayName';
import { canPublishWorkflow } from '@/services/authorizationPolicyService';
import { getServiceCatalog } from '@/services/pricingService';
import {
  recordWorkflowTemplateApprovalRefused,
  recordWorkflowTemplateVersionApproved,
  type WorkflowApprovalAttestation,
} from '@/services/activityService';
import { serviceTypeItems } from '@/domain/pricing/calculateOrder';
import { isWorkflowApprovalRequired, isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';
import { isApprovedVersion, latestApprovedVersion } from '@/domain/workflow/snapshot';
import { problemMessages, validateWorkflowStages } from '@/domain/workflow/templateValidation';
import { validateIntakeFields } from '@/domain/workflow/editing';
import type { WorkflowTemplate, WorkflowTemplateVersion } from '@/types/workflowTemplate';

/**
 * Service-specific workflows (2026-10). Approves one draft workflow
 * template version so live cases may use it — the step that makes a
 * service's workflow selectable at case creation
 * (domain/workflow/selectWorkflowTemplate.ts only ever snapshots an
 * approved version).
 *
 * Only for organizations whose profile sets
 * `features.workflowApprovalRequired` (403 otherwise — nothing else has
 * drafts). Permission: `workflow.publish` (canPublishWorkflow), the same
 * permission that saves a version — approving is what makes a version
 * live, which is exactly what "publish" means; no new permission is
 * invented. Organization-scoped: another organization's template is 404.
 *
 * Approval changes ONLY the version's status/approvedBy/approvedAt —
 * never its stages, intake or number — so the version's content stays
 * exactly what was reviewed.
 *
 * Workflow template editor (2026-10):
 * - Only a valid, COMPLETE version can be approved: the 'approval' level
 *   of domain/workflow/templateValidation.ts runs server-side against the
 *   version's own content (and its service assignment against the
 *   organization's active catalog and other enabled templates). Any
 *   problem is a 422 carrying the full list — never a partial approval.
 * - An already-approved version is refused (409) rather than silently
 *   re-approved, so approvedBy/approvedAt always record the one real
 *   approval.
 * - A service assignment carried by the version
 *   (WorkflowTemplateVersion.serviceTypeCodes) is applied to the template
 *   here, at the moment it goes live — never when the draft is saved.
 * - A `workflow.template.published` activity event records who approved
 *   which version, of which template, for which service — once, right
 *   after the version itself is approved.
 *
 * Wix writes (2026-10 hardening):
 * - The version row is approved with a CONDITIONAL patch of only
 *   status/approvedBy/approvedAt(/approvedByName) on `status $eq 'draft'`
 *   — never a full replace of a row read earlier. Two concurrent
 *   approvals both pass the read-time check, but only one patch applies;
 *   the other gets Wix's 428 and answers 409 (no second approvedBy, no
 *   second activity event).
 * - The version is written FIRST, the template row's serviceTypeCodes
 *   second (a single-field patch, organization-guarded). Writing the
 *   template first would route new cases for that service to a template
 *   whose version is still a draft. If the second write fails the answer
 *   is 503 with the version approved; a retry then finds the version
 *   approved with its assignment still pending and completes it
 *   (idempotent completion) instead of refusing it as already approved.
 *   Only the template's LATEST approved version can complete this way, so
 *   a stale retry can never overwrite a newer approval's assignment.
 *
 * Unfinished-workflow protection & service-specific completion (2026-10):
 * - The approver must ATTEST, in the request, that they reviewed the
 *   service-specific stages, the checklist items AND the completion rules:
 *   `attestation: { stagesReviewed: true, checklistReviewed: true,
 *   completionReviewed: true }` — anything less is a 422 (the editor asks
 *   with three in-page checkboxes, never a browser dialog). The
 *   attestation is recorded in the `workflow.template.published` event.
 * - Approval validation additionally refuses: a version with no
 *   completion policy, or an incomplete one (a burial/entombment policy
 *   with no required final items); any placeholder stage
 *   ("… — steps to be defined"); and a version that is still an
 *   unmodified copy of another template ("This workflow is still an
 *   unmodified copy of Direct Cremation; define the service-specific
 *   steps before approval.") — domain/workflow/templateValidation.ts.
 * - EVERY decision is audited: a refused attempt (422) records
 *   `workflow.template.approval_refused` with each reason, alongside the
 *   existing `workflow.template.published` for an approval.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string; version: string }> },
) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { templateId, version: versionParam } = await params;
  const body: unknown = await request.json().catch(() => null);
  const requestedOrganizationId =
    body && typeof body === 'object' && typeof (body as Record<string, unknown>).organizationId === 'string'
      ? ((body as Record<string, unknown>).organizationId as string)
      : null;
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  if (!isWorkflowApprovalRequired(organizationId)) {
    return NextResponse.json({ error: 'Workflow approval is not enabled for this organization.' }, { status: 403 });
  }

  const adapter = getDataAdapterMode();
  if (!(await canPublishWorkflow({ identityId: userId, organizationId, roleKey: role }, adapter))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const attestation = parseAttestation((body as Record<string, unknown>).attestation);

  const versionNumber = Number(versionParam);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    return NextResponse.json({ error: 'version must be a positive integer.' }, { status: 400 });
  }

  const approvedByName = await currentActorDisplayName(userId);
  const approval = { approvedBy: userId, approvedAt: new Date().toISOString(), ...(approvedByName ? { approvedByName } : {}) };
  const notFound = () =>
    NextResponse.json({ error: `Workflow template ${templateId} version ${versionNumber} not found for this organization` }, { status: 404 });
  const alreadyApproved = () =>
    NextResponse.json({ error: `Version ${versionNumber} is already approved.` }, { status: 409 });

  /** Server-side completeness check — the same rules the editor shows. */
  async function approvalProblems(template: WorkflowTemplate, target: WorkflowTemplateVersion, organizationTemplates: WorkflowTemplate[]) {
    const byServiceType = isWorkflowByServiceType(organizationId);
    const serviceTypeCodes = byServiceType ? (target.serviceTypeCodes ?? template.serviceTypeCodes ?? []) : undefined;
    const catalog = byServiceType ? serviceTypeItems(await getServiceCatalog(organizationId, adapter)) : [];
    const problems = validateWorkflowStages(target.stages, 'approval', {
      serviceTypeCodes,
      activeServiceTypeCodes: byServiceType ? catalog.map((item) => item.serviceCode) : undefined,
      requireServiceAssignment: byServiceType,
      organizationTemplates,
      templateId: template.id,
      templateIsEnabled: template.isEnabled,
      serviceDisplayName: (code) => catalog.find((item) => item.serviceCode === code)?.displayName,
      // Service-specific completion & unfinished-workflow protection.
      completionPolicy: target.completionPolicy ?? null,
      requireCompletionPolicy: true,
      checkUnmodifiedCopy: true,
      derivedFrom: target.derivedFrom ?? null,
      composition: target.composition ?? null,
    });
    const intakeProblems = validateIntakeFields(target.intake);
    return [...problemMessages(problems), ...intakeProblems].length > 0
      ? { problems, details: [...problemMessages(problems), ...intakeProblems] }
      : null;
  }
  /** A refused approval — audited (best-effort), then answered 422. */
  async function refuse(
    template: WorkflowTemplate,
    target: WorkflowTemplateVersion,
    error: string,
    result: { problems: { code?: string; message: string }[]; details: string[] },
  ) {
    try {
      await recordWorkflowTemplateApprovalRefused(
        { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
        {
          templateId: template.id,
          templateName: template.name,
          version: versionNumber,
          serviceTypeCodes: target.serviceTypeCodes ?? template.serviceTypeCodes ?? null,
          reasons: result.details,
          codes: result.problems.map((problem) => problem.code ?? 'invalid'),
          ...(attestation.value ? { attestation: attestation.value } : {}),
        },
        adapter,
      );
    } catch (failure) {
      console.error('Failed to record workflow.template.approval_refused activity event:', failure instanceof Error ? failure.message : failure);
    }
    return NextResponse.json({ error, details: result.details, problems: result.problems }, { status: 422 });
  }
  const invalid = (template: WorkflowTemplate, target: WorkflowTemplateVersion, result: { problems: { code?: string; message: string }[]; details: string[] }) =>
    refuse(template, target, `Version ${versionNumber} cannot be approved until these problems are fixed.`, result);
  /** The review attestation is checked BEFORE the content: an approver
      who has not affirmed the review gets that one answer, not a list of
      content problems they have not looked at yet. */
  const missingAttestation = (template: WorkflowTemplate, target: WorkflowTemplateVersion) =>
    refuse(template, target, ATTESTATION_REQUIRED_MESSAGE, {
      details: [ATTESTATION_REQUIRED_MESSAGE],
      problems: [{ code: 'attestation_missing', message: ATTESTATION_REQUIRED_MESSAGE }],
    });

  /** The service assignment an APPROVED version still has to apply to its
      template — set when an earlier approval's template-row write failed
      (see the header). Null when there is nothing left to do. */
  function pendingServiceAssignment(template: WorkflowTemplate, target: WorkflowTemplateVersion): string[] | null {
    if (!isWorkflowByServiceType(organizationId) || !target.serviceTypeCodes || target.status !== 'approved') return null;
    if (latestApprovedVersion(template)?.version !== target.version) return null;
    const current = [...(template.serviceTypeCodes ?? [])].sort().join('|');
    return current === [...target.serviceTypeCodes].sort().join('|') ? null : [...target.serviceTypeCodes];
  }

  async function recordApproved(template: WorkflowTemplate, serviceTypeCodes: string[] | null) {
    // Best-effort, like every other activity event — never fails an
    // approval that has already been written.
    try {
      await recordWorkflowTemplateVersionApproved(
        { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
        {
          templateId: template.id,
          templateName: template.name,
          version: versionNumber,
          status: 'approved',
          serviceTypeCodes,
          ...(attestation.value ? { attestation: attestation.value } : {}),
          completionPolicy: template.versions.find((v) => v.version === versionNumber)?.completionPolicy ?? null,
        },
        adapter,
      );
    } catch (error) {
      console.error('Failed to record workflow.template.published activity event:', error instanceof Error ? error.message : error);
    }
  }

  if (adapter === 'mock') {
    const template = workflowTemplateFixtures.find((t) => t.id === templateId && t.organizationId === organizationId);
    const target = template?.versions.find((v) => v.version === versionNumber);
    if (!template || !target) return notFound();
    if (isApprovedVersion(target)) return alreadyApproved();
    if (!attestation.value) return missingAttestation(template, target);
    const failed = await approvalProblems(
      template,
      target,
      workflowTemplateFixtures.filter((t) => t.organizationId === organizationId),
    );
    if (failed) return invalid(template, target, failed);
    // Re-checked after the awaits above, then written synchronously — the
    // mock's equivalent of the Wix path's conditional patch: of two
    // concurrent approvals exactly one applies.
    if (isApprovedVersion(target)) return alreadyApproved();
    Object.assign(target, { status: 'approved' as const, ...approval });
    if (target.serviceTypeCodes && isWorkflowByServiceType(organizationId)) template.serviceTypeCodes = [...target.serviceTypeCodes];
    await recordApproved(template, template.serviceTypeCodes ?? null);
    return NextResponse.json({ workflowTemplate: template });
  }

  try {
    const existing = await fetchWixWorkflowTemplateById(organizationId, templateId);
    const target = existing?.versions.find((v) => v.version === versionNumber);
    if (!existing || !target) return notFound();

    /** The second write: only serviceTypeCodes on the template row. */
    async function applyServiceAssignment(serviceTypeCodes: string[]): Promise<boolean> {
      const templateRows = await queryWixDataItems<WixWorkflowTemplateItem>('workflowTemplates', {
        filter: { beaconTemplateId: templateId, organizationId },
        paging: { limit: 1 },
      });
      const templateRow = templateRows.dataItems[0];
      if (!templateRow) return false;
      const result = await conditionalPatchWixDataItem('workflowTemplates', templateRow.id, 'serviceTypeCodes', [...serviceTypeCodes], {
        filter: { organizationId: { $eq: organizationId } },
      });
      return result.applied;
    }
    const assignmentFailed = () =>
      NextResponse.json(
        { error: `Version ${versionNumber} was approved, but its service assignment could not be saved. Try approving again to finish.` },
        { status: 503 },
      );

    if (isApprovedVersion(target)) {
      // Idempotent completion of an earlier approval whose second write failed.
      const pending = pendingServiceAssignment(existing, target);
      if (!pending) return alreadyApproved();
      if (!(await applyServiceAssignment(pending))) return assignmentFailed();
      return NextResponse.json({ workflowTemplate: { ...existing, serviceTypeCodes: pending } satisfies WorkflowTemplate });
    }

    if (!attestation.value) return missingAttestation(existing, target);
    const failed = await approvalProblems(existing, target, await fetchWixWorkflowTemplates(organizationId));
    if (failed) return invalid(existing, target, failed);

    const rows = await queryWixDataItems<WixWorkflowTemplateVersionItem>('workflowTemplateVersions', {
      filter: { beaconTemplateId: templateId, version: versionNumber },
      paging: { limit: 1 },
    });
    const row = rows.dataItems[0];
    if (!row) return notFound();
    const patched = await conditionalPatchWixDataItemFields('workflowTemplateVersions', row.id, buildWixWorkflowTemplateVersionApprovalFields(approval), {
      filter: { status: { $eq: 'draft' } },
    });
    if (!patched.applied) {
      // 428: the row is no longer a draft — another approval won.
      if (patched.status === 428) return alreadyApproved();
      return NextResponse.json({ error: `Wix Data approval write failed (HTTP ${patched.status}).` }, { status: 503 });
    }

    const proposed = isWorkflowByServiceType(organizationId) && target.serviceTypeCodes ? [...target.serviceTypeCodes] : null;
    await recordApproved(existing, proposed ?? existing.serviceTypeCodes ?? null);
    // Only a CHANGED assignment is written (a version that keeps its
    // template's service — the usual case — writes nothing more).
    const assignment =
      proposed && [...proposed].sort().join('|') !== [...(existing.serviceTypeCodes ?? [])].sort().join('|') ? proposed : null;

    // The version's service assignment goes live with it.
    if (assignment && !(await applyServiceAssignment(assignment))) return assignmentFailed();

    const workflowTemplate: WorkflowTemplate = {
      ...existing,
      ...(assignment ? { serviceTypeCodes: assignment } : {}),
      versions: existing.versions.map((v) => (v.version === versionNumber ? { ...v, status: 'approved', ...approval } : v)),
    };
    return NextResponse.json({ workflowTemplate });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

const ATTESTATION_REQUIRED_MESSAGE =
  'Confirm that the service-specific stages, the checklist items and the completion rules have been reviewed before approving.';

/** `attestation` must affirm all three reviews — each exactly `true`. */
function parseAttestation(value: unknown): { value: WorkflowApprovalAttestation | null } {
  if (!value || typeof value !== 'object') return { value: null };
  const raw = value as Record<string, unknown>;
  return raw.stagesReviewed === true && raw.checklistReviewed === true && raw.completionReviewed === true
    ? { value: { stagesReviewed: true, checklistReviewed: true, completionReviewed: true } }
    : { value: null };
}

