import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadDocumentTemplate } from '@/services/authorizationPolicyService';
import { get as getTemplate, getActiveVersion, previewTemplate } from '@/services/documentTemplatesService';
import { resolveMergeSourceData } from '@/services/documentService';
import { buildSampleMergeSourceData } from '@/domain/documents/mergeEngine';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 25 (Document Generation & Template Management). Server-side
 * merge preview — returns rendered HTML only, never a PDF and never
 * touches storage. `caseId` is optional: omitted, this previews against
 * synthetic sample data (useful while first authoring a template);
 * provided, it merges against the real case exactly like `generate()`
 * would, so a "preview before generating" step is a true preview, not an
 * approximation.
 *
 * Dual-mode (`requireAuthorizedOrganization`), not identity-only: this is
 * called by the case-scoped Generate/Regenerate Document dialog on the
 * universal Case Detail page (see GET /api/document-templates's own
 * comment for the identical reasoning), not just the identity-mode-gated
 * Template Library page.
 */
export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { templateId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; body?: unknown; caseId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadDocumentTemplate({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view document templates for this organization.' }, { status: 403 });
  }

  let templateBody: string;
  if (typeof b.body === 'string') {
    templateBody = b.body;
  } else {
    const template = await getTemplate(organizationId, templateId, dataAdapterMode);
    if (!template) {
      return NextResponse.json({ error: 'Document template not found.' }, { status: 404 });
    }
    templateBody = getActiveVersion(template).body;
  }

  try {
    const source = typeof b.caseId === 'string' ? await resolveMergeSourceData(organizationId, b.caseId, dataAdapterMode) : buildSampleMergeSourceData();
    const html = previewTemplate(templateBody, source);
    return NextResponse.json({ html });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to render preview.' }, { status: 400 });
  }
}
