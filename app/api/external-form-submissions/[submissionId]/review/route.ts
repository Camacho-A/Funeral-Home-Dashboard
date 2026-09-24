import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadCases, canEditCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import { buildReconciliationRows } from '@/domain/externalForms/reconciliation';
import type { MappedSolisField } from '@/domain/externalForms/fieldMapping';
import { recordExternalFormFieldsApplied, recordExternalFormSubmissionReviewed } from '@/services/activityService';
import type { Case } from '@/types/case';

/** Maps a MappedSolisField onto the exact Case patch shape PATCH
    /api/cases/[caseId] already validates — never a new update mechanism,
    purely a translation table into the existing one. isVeteran arrives
    as the string 'true'/'false' from extractMappedFields (a boolean
    field mapped through a plain string valueMap) and is coerced here. */
function buildCasePatch(fields: MappedSolisField[], mapped: Partial<Record<MappedSolisField, string>>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const value = mapped[field];
    if (value === undefined) continue;
    if (field === 'isVeteran') {
      patch.isVeteran = value === 'true';
    } else if (field === 'pickupReleasedTo' || field === 'pickupReleaseRelationship') {
      if (field === 'pickupReleasedTo') patch.pickupReleasedTo = value;
      // pickupReleaseRelationship has no Case destination — never applied.
    } else {
      patch[field] = value;
    }
  }
  return patch;
}

async function loadCase(organizationId: string, caseId: string, dataAdapterMode: string): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', { filter: { _id: caseId, organizationId }, paging: { limit: 1 } });
  return response.dataItems[0] ? mapWixCaseItem(response.dataItems[0].data) : null;
}

function currentValuesFromCase(theCase: Case): Partial<Record<MappedSolisField, string | null>> {
  return {
    decedentName: theCase.decedentName,
    dateOfBirth: theCase.dateOfBirth,
    dateOfDeath: theCase.dateOfDeath,
    placeOfDeath: theCase.placeOfDeath,
    isVeteran: theCase.isVeteran ? 'true' : 'false',
    nextOfKinName: theCase.nextOfKinName,
    nextOfKinRelationship: theCase.nextOfKinRelationship,
    nextOfKinPhone: theCase.nextOfKinPhone,
    nextOfKinEmail: theCase.nextOfKinEmail,
    pickupReleasedTo: theCase.pickupReleasedTo,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  const caseId = url.searchParams.get('caseId');
  if (!organizationId || !caseId) {
    return NextResponse.json({ error: 'organizationId and caseId are required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadCases({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to review submissions for this organization.' }, { status: 403 });
  }

  const submission = await externalFormSubmissionService.getById(submissionId, dataAdapterMode);
  if (!submission || submission.organizationId !== resolvedOrganizationId) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }

  const theCase = await loadCase(resolvedOrganizationId, caseId, dataAdapterMode);
  if (!theCase) {
    return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
  }

  const mapped = JSON.parse(submission.mappedFields) as Partial<Record<MappedSolisField, string>>;
  const rows = buildReconciliationRows(currentValuesFromCase(theCase), mapped);

  // Data minimization (2026-09): ExternalFormSubmission no longer retains a
  // full rawPayload at all, so there is nothing left to strip here — the
  // submission object is already safe to return as-is.
  return NextResponse.json({ submission, rows });
}

export async function POST(request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { submissionId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; caseId?: unknown; fieldsToApply?: unknown };
  if (typeof b.organizationId !== 'string' || typeof b.caseId !== 'string' || !Array.isArray(b.fieldsToApply)) {
    return NextResponse.json({ error: 'organizationId, caseId, and fieldsToApply are required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to apply form data to this case.' }, { status: 403 });
  }

  const submission = await externalFormSubmissionService.getById(submissionId, dataAdapterMode);
  if (!submission || submission.organizationId !== organizationId) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }

  const mapped = JSON.parse(submission.mappedFields) as Partial<Record<MappedSolisField, string>>;
  const fieldsToApply = (b.fieldsToApply as string[]).filter((f): f is MappedSolisField => f in mapped);
  const patch = buildCasePatch(fieldsToApply, mapped);

  if (Object.keys(patch).length > 0) {
    // Reuses the EXISTING, fully-validated case-update Route Handler —
    // never a second update mechanism. An internal same-origin-shaped
    // request (explicit matching Origin/Host, the real caller's own
    // session cookie forwarded) so PATCH /api/cases/[caseId]'s own
    // requireSameOrigin + RBAC + validation all apply exactly as they
    // would for a direct browser call.
    const origin = new URL(request.url).origin;
    const patchResponse = await fetch(`${origin}/api/cases/${encodeURIComponent(b.caseId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({ organizationId, patch }),
    });
    if (!patchResponse.ok) {
      const errorBody = await patchResponse.json().catch(() => ({}));
      return NextResponse.json({ error: errorBody.error ?? 'Failed to apply fields to case.' }, { status: patchResponse.status });
    }

    try {
      await recordExternalFormFieldsApplied(
        { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
        b.caseId,
        submission.id,
        fieldsToApply,
        dataAdapterMode,
      );
    } catch (error) {
      console.error('Failed to record external_form.fields_applied activity event:', error instanceof Error ? error.message : error);
    }
  }

  const reviewed = await externalFormSubmissionService.markReviewed(submission.id, userId, dataAdapterMode);
  if (submission.caseFormLinkId) {
    await caseFormLinkService.markReviewed(submission.caseFormLinkId, dataAdapterMode);
  }

  try {
    await recordExternalFormSubmissionReviewed(
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      b.caseId,
      submission.id,
      'form',
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record external_form.submission_reviewed activity event:', error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ submission: reviewed });
}
