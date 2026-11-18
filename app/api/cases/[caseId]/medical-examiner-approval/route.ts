import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getDataAdapterMode } from '@/lib/env';
import { canEditCase } from '@/services/authorizationPolicyService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { MedicalExaminerApprovalServiceError, recordMedicalExaminerApprovalForCase } from '@/services/medicalExaminerApprovalService';

/**
 * Gus Phase 5G (2026-11). POST { organizationId, confirmedInEdrs, approvalDate
 * (YYYY-MM-DD), reference, evidenceDocumentId?, evidenceSource?, reason? }
 * → records the medical examiner cremation approval staff confirmed in EDRS
 * (case.update). Recorder and time come from the session and the server.
 * Records only; releases and sends nothing.
 */
const str = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length <= max ? value : null);

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { caseId } = await params;
  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const auth = await requireAuthorizedOrganization(body.organizationId);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();
  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to change this case.' }, { status: 403 });
  }
  const approvalDate = str(body.approvalDate, 10);
  const reference = str(body.reference, 200);
  if (typeof body.confirmedInEdrs !== 'boolean' || approvalDate === null || reference === null) {
    return NextResponse.json({ error: 'confirmedInEdrs, approvalDate and reference are required.' }, { status: 400 });
  }
  const evidenceDocumentId = body.evidenceDocumentId == null ? null : str(body.evidenceDocumentId, 100);
  const evidenceSource = body.evidenceSource == null ? null : str(body.evidenceSource, 200);
  const reason = body.reason == null ? null : str(body.reason, 200);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const actorName = (await resolveStaffProfileForCaller({ organizationId, userId, role }, mode))?.displayName ?? null;
    const medicalExaminer = await recordMedicalExaminerApprovalForCase(
      ctx,
      caseId,
      { confirmedInEdrs: body.confirmedInEdrs, approvalDate, reference, evidenceDocumentId, evidenceSource, reason, actorName },
      mode,
    );
    return NextResponse.json({ medicalExaminer });
  } catch (error) {
    if (error instanceof MedicalExaminerApprovalServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Recording the ME approval failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not record the approval. Please try again.' }, { status: 500 });
  }
}
