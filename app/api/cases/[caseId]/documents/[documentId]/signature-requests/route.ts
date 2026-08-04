import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadSignature, canRequestSignature } from '@/services/authorizationPolicyService';
import { listRequests, listRecords, createSignatureRequest, SignatureServiceError } from '@/services/signatureService';
import { getDataAdapterMode } from '@/lib/env';
import crypto from 'crypto';

// Phase 27 (Scheduling & Resource Management): 'witness' is deliberately
// NOT accepted here — a witness SignatureRequest is only ever created
// programmatically by services/schedulingService.ts's
// createWitnessSignatureRequest, tied to a specific Witness Cremation
// appointment, never picked freely from this general-purpose staff dialog.
const VALID_SIGNER_ROLES = ['primary_contact', 'secondary_contact', 'next_of_kin', 'authorized_representative', 'funeral_director', 'internal_staff'];

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Dual-mode
 * `requireAuthorizedOrganization`, matching every other case-scoped
 * document route — this is reachable from the universal Case Detail
 * page's Documents tab (see `docs/adr/ADR-029-...md`'s own retrospective
 * on getting this wrong for two Phase 25 routes). Delegates entirely to
 * `services/signatureService.ts`; no token/status/audit/notification
 * logic lives here.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const { caseId, documentId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadSignature({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view signature requests for this case.' }, { status: 403 });
  }

  const [requests, records] = await Promise.all([
    listRequests(organizationId, caseId, documentId, dataAdapterMode),
    listRecords(organizationId, caseId, documentId, dataAdapterMode),
  ]);
  return NextResponse.json({ requests, records });
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId, documentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; signerName?: unknown; signerEmail?: unknown; signerRole?: unknown; expiresAt?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof b.signerName !== 'string' || !b.signerName.trim()) {
    return NextResponse.json({ error: 'signerName is required.' }, { status: 400 });
  }
  if (typeof b.signerEmail !== 'string' || !b.signerEmail.trim()) {
    return NextResponse.json({ error: 'signerEmail is required.' }, { status: 400 });
  }
  if (typeof b.signerRole !== 'string' || !VALID_SIGNER_ROLES.includes(b.signerRole)) {
    return NextResponse.json({ error: 'A valid signerRole is required.' }, { status: 400 });
  }
  if (b.expiresAt !== undefined && typeof b.expiresAt !== 'string') {
    return NextResponse.json({ error: 'expiresAt must be a string if provided.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canRequestSignature({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to request signatures for this case.' }, { status: 403 });
  }

  try {
    const signatureRequest = await createSignatureRequest(
      {
        caseId,
        documentId,
        signerName: b.signerName,
        signerEmail: b.signerEmail,
        signerRole: b.signerRole as never,
        expiresAt: b.expiresAt as string | undefined,
        idFactory: () => crypto.randomUUID(),
      },
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ request: signatureRequest }, { status: 201 });
  } catch (error) {
    if (error instanceof SignatureServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 422 });
    }
    throw error;
  }
}
