import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { uploadBrandingLogo, removeBrandingLogo } from '@/services/organizationProvisioningService';
import { BrandingStorageNotConfiguredError } from '@/lib/vercelBlob/vercelBlobConfig';
import { getDataAdapterMode } from '@/lib/env';

/** 5MB — generous for a web logo, well under the 15MB case-document
    limit (app/api/cases/[caseId]/documents/upload/route.ts); a logo is
    rendered small (Sidebar footer, ~32px) and never needs print-quality
    resolution. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

type UploadedFilePart = { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

/** Duck-typed, not `instanceof File` — same reasoning as the case-document
    upload route's own identical helper. */
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

/**
 * Organization Branding Settings phase. The real authenticated write path
 * for `OrganizationBranding.logoUrl` — `organizationId` arriving in the
 * multipart form (or the DELETE JSON body) is never trusted as
 * authorization by itself; `requireAuthorizedOrganization` re-resolves it
 * from the caller's own session/membership before anything is touched,
 * exactly like every other mutating route in this codebase (the case-
 * document upload route's own identical pattern). Gated on
 * `organization.manage` — the same permission already gating Settings →
 * Organization Profile, the narrowest existing fit ("Manage the
 * organization's own profile and settings"); no new permission invented.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data.' }, { status: 400 });
  }

  const organizationId = formData.get('organizationId');
  const file = formData.get('file');

  if (typeof organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (!isUploadedFilePart(file)) {
    return NextResponse.json({ error: 'file is required.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'The selected file is empty.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Logo exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit.` }, { status: 400 });
  }
  const extension = MIME_TO_EXTENSION[file.type];
  if (!extension) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}. Allowed: PNG, JPEG, WEBP.` }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageOrganization({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage branding for this organization.' }, { status: 403 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());

  try {
    const branding = await uploadBrandingLogo(
      { organizationId: resolvedOrganizationId, fileBuffer, mimeType: file.type, fileExtension: extension, idFactory: () => crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ branding }, { status: 200 });
  } catch (error) {
    // Distinct from a transient upload failure (502 below): this means
    // the second, PUBLIC branding Blob store has never been connected/
    // configured at all — see vercelBlobConfig.ts's own comment. The
    // error's own message is already safe to return as-is; it names the
    // missing environment variable, never its value.
    if (error instanceof BrandingStorageNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : 'Failed to upload logo.';
    return NextResponse.json({ error: `Logo upload failed: ${message}` }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId } = parsed.body;

  if (typeof organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageOrganization({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage branding for this organization.' }, { status: 403 });
  }

  const branding = await removeBrandingLogo(resolvedOrganizationId, dataAdapterMode);
  return NextResponse.json({ branding }, { status: 200 });
}
