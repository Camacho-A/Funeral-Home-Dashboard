import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canUploadDocument } from '@/services/authorizationPolicyService';
import { upload, DocumentServiceError } from '@/services/documentService';
import { isValidDocumentTypeKey } from '@/domain/documents/documentTypeRegistry';
import { getDataAdapterMode } from '@/lib/env';

/** 15MB — see this phase's Security section (file size/type limits). */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

type UploadedFilePart = { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

/** Duck-typed rather than `instanceof File` — a multipart part parsed back
    out of `request.formData()` isn't guaranteed to be `instanceof` the
    same `File` constructor a caller (or a test) referenced directly;
    what matters is that it behaves like a file. */
function isUploadedFilePart(value: unknown): value is UploadedFilePart {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { size?: unknown }).size === 'number' &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data.' }, { status: 400 });
  }

  const organizationId = formData.get('organizationId');
  const file = formData.get('file');
  const documentTypeKey = formData.get('documentTypeKey');
  const category = formData.get('category');

  if (typeof organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (!isUploadedFilePart(file)) {
    return NextResponse.json({ error: 'file is required.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit.` }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}. Allowed: PDF, JPEG, PNG, DOCX.` }, { status: 400 });
  }
  if (documentTypeKey !== null && (typeof documentTypeKey !== 'string' || !isValidDocumentTypeKey(documentTypeKey))) {
    return NextResponse.json({ error: 'Invalid documentTypeKey.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canUploadDocument({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to upload documents for this case.' }, { status: 403 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const correlationId = crypto.randomUUID();

  try {
    const document = await upload(
      {
        caseId,
        fileName: file.name,
        mimeType: file.type,
        documentTypeKey: typeof documentTypeKey === 'string' ? documentTypeKey : undefined,
        category: typeof category === 'string' ? (category as never) : undefined,
        idFactory: () => crypto.randomUUID(),
      },
      fileBuffer,
      { organizationId: resolvedOrganizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId },
      dataAdapterMode,
    );
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
