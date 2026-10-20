import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canGenerateDocument } from '@/services/authorizationPolicyService';
import { generateOfficialDocumentForCase } from '@/services/automaticCaseDocuments';
import type { OfficialDocumentKind } from '@/domain/documents/officialDocumentTriggers';
import { getDataAdapterMode } from '@/lib/env';

export const maxDuration = 60;

const KINDS: readonly OfficialDocumentKind[] = ['envelope', 'certificate_of_cremation'];

/**
 * Envelope / Certificate of Cremation on demand (2026-10). Both are also
 * generated automatically (services/automaticCaseDocuments.ts); this is how
 * staff produce one for a case that existed before that, or retry after a
 * failure. Same permission as every other document generation.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; kind?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.kind !== 'string' || !(KINDS as readonly string[]).includes(b.kind)) {
    return NextResponse.json({ error: `kind must be one of: ${KINDS.join(', ')}.` }, { status: 400 });
  }
  const kind = b.kind as OfficialDocumentKind;

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canGenerateDocument({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to generate documents for this case.' }, { status: 403 });
  }

  const { outcome, missing } = await generateOfficialDocumentForCase(
    kind,
    caseId,
    { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
    dataAdapterMode,
  );
  const documentName = kind === 'certificate_of_cremation' ? 'Certificate of Cremation' : 'Envelope';

  switch (outcome) {
    case 'generated':
      return NextResponse.json({ generated: true }, { status: 201 });
    case 'case_not_found':
      return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
    case 'missing_information':
      return NextResponse.json(
        { error: `Before generating the ${documentName}, add the following to this case: ${missing.join(', ')}.`, missing },
        { status: 422 },
      );
    case 'not_applicable':
      return NextResponse.json({ error: `The ${documentName} is not available for this organization.` }, { status: 422 });
    case 'template_unavailable':
      return NextResponse.json(
        {
          error:
            'The signed Certificate of Cremation template could not be found in document storage, so nothing was generated. ' +
            'The case information is saved. Ask an administrator to check the template setup.',
        },
        { status: 409 },
      );
    default:
      return NextResponse.json({ error: `The ${documentName} could not be generated. Nothing on the case was changed. Please try again.` }, { status: 500 });
  }
}
