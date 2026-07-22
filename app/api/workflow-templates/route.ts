import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { fetchWixWorkflowTemplates } from '@/lib/wixWorkflowTemplateMapper';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';

/**
 * Phase 15B (Wix Workflow Template Read Integration). Lists workflow
 * templates for one organization — see
 * docs/adr/ADR-012-wix-workflow-template-read-integration.md.
 *
 * In mock mode: filters services/__mocks__/workflowTemplates.ts's
 * workflowTemplateFixtures by organizationId — byte-for-byte the same
 * logic services/workflowTemplatesService.ts's list() used to run
 * directly in the browser bundle.
 *
 * In wix mode: queries the `workflowTemplates` collection filtered by
 * organizationId, then — for each matched template — queries
 * `workflowTemplateVersions` filtered by that template's beaconTemplateId
 * and re-joins the two into the nested WorkflowTemplate shape via
 * lib/wixWorkflowTemplateMapper.ts's fetchWixWorkflowTemplates (moved
 * there in Phase 16 so app/api/cases/route.ts's create handler can reuse
 * it too). A template with zero valid versions is excluded from the
 * result; a malformed template or version record is skipped, never
 * thrown on.
 */
export async function GET(request: Request) {
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ workflowTemplates: [], error: 'organizationId is required.' }, { status: 400 });
  }

  // Phase 15X (Multi-Tenant Authorization Hardening): the query param is
  // untrusted — re-derived from the caller's session/membership below,
  // never used directly. See lib/auth/requireAuthorizedOrganization.ts.
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const adapter = getDataAdapterMode();

  if (adapter === 'mock') {
    const workflowTemplates = workflowTemplateFixtures.filter((t) => t.organizationId === organizationId);
    return NextResponse.json({ workflowTemplates });
  }

  try {
    const workflowTemplates = await fetchWixWorkflowTemplates(organizationId);
    return NextResponse.json({ workflowTemplates });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ workflowTemplates: [], error: message }, { status: 503 });
  }
}
