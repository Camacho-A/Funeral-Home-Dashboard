import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { insertWixDataItem, WixDataApiError } from '@/lib/wixDataApi';
import {
  fetchWixWorkflowTemplateById,
  buildWixWorkflowTemplateVersionData,
  validateWorkflowStagesPayload,
  validateIntakeTemplatePayload,
} from '@/lib/wixWorkflowTemplateMapper';
import { validateStageSequencing, validateIntakeFields } from '@/domain/workflow/editing';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import type { WorkflowTemplate, WorkflowTemplateVersion } from '@/types/workflowTemplate';

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
 */
export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
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
  const { organizationId } = authResult.context;

  const { stages, errors: stageShapeErrors } = validateWorkflowStagesPayload(body);
  if (!stages) {
    return NextResponse.json({ error: 'Invalid stages payload.', details: stageShapeErrors }, { status: 400 });
  }

  const { intake, errors: intakeShapeErrors } = validateIntakeTemplatePayload(body);
  if (!intake) {
    return NextResponse.json({ error: 'Invalid intake payload.', details: intakeShapeErrors }, { status: 400 });
  }

  const sequencingErrors = validateStageSequencing(stages);
  if (sequencingErrors.length > 0) {
    return NextResponse.json({ error: 'Invalid workflow structure.', details: sequencingErrors }, { status: 400 });
  }

  const intakeErrors = validateIntakeFields(intake);
  if (intakeErrors.length > 0) {
    return NextResponse.json({ error: 'Invalid intake structure.', details: intakeErrors }, { status: 400 });
  }

  const adapter = getDataAdapterMode();

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
    };
    template.versions.push(newVersion);
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

    const versionData = buildWixWorkflowTemplateVersionData({
      beaconTemplateId: templateId,
      version: nextVersionNumber,
      caseTypes: latest.caseTypes,
      stages,
      intake,
      createdAt,
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
    };
    const workflowTemplate: WorkflowTemplate = {
      ...existing,
      versions: [...existing.versions, newVersion],
    };
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
