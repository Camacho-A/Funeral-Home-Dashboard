import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import {
  buildWorkflowTemplate,
  mapWixWorkflowTemplateItem,
  mapWixWorkflowTemplateVersionItem,
  type WixWorkflowTemplateItem,
  type WixWorkflowTemplateVersionItem,
} from '@/lib/wixWorkflowTemplateMapper';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';

/**
 * Phase 15B (Wix Workflow Template Read Integration). Retrieves one
 * workflow template by its Beacon domain id, scoped by organizationId —
 * a template whose id matches but whose organizationId doesn't is treated
 * identically to "not found" (404), never returned, per "every
 * workflow-template list or lookup must be scoped by organizationId."
 *
 * Mirrors app/api/workflow-templates/route.ts's mock/wix branching and
 * mapping exactly; see that file's comment and
 * docs/adr/ADR-012-wix-workflow-template-read-integration.md.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ workflowTemplate: null, error: 'organizationId is required.' }, { status: 400 });
  }

  // Phase 15X (Multi-Tenant Authorization Hardening): re-derived from the
  // caller's session/membership, never trusted from the query param.
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const adapter = getDataAdapterMode();

  if (adapter === 'mock') {
    const workflowTemplate =
      workflowTemplateFixtures.find((t) => t.id === templateId && t.organizationId === organizationId) ?? null;
    if (!workflowTemplate) {
      return NextResponse.json({ workflowTemplate: null }, { status: 404 });
    }
    return NextResponse.json({ workflowTemplate });
  }

  try {
    const templatesResponse = await queryWixDataItems<WixWorkflowTemplateItem>('workflowTemplates', {
      filter: { beaconTemplateId: templateId, organizationId },
      paging: { limit: 1 },
    });

    const summary = mapWixWorkflowTemplateItem(templatesResponse.dataItems[0]?.data);
    if (!summary) {
      return NextResponse.json({ workflowTemplate: null }, { status: 404 });
    }

    const versionsResponse = await queryWixDataItems<WixWorkflowTemplateVersionItem>('workflowTemplateVersions', {
      filter: { beaconTemplateId: summary.id },
    });
    const versions = versionsResponse.dataItems
      .map((item) => mapWixWorkflowTemplateVersionItem(item.data))
      .filter((version) => version !== null);

    const workflowTemplate = buildWorkflowTemplate(summary, versions);
    if (!workflowTemplate) {
      return NextResponse.json({ workflowTemplate: null }, { status: 404 });
    }
    return NextResponse.json({ workflowTemplate });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ workflowTemplate: null, error: message }, { status: 503 });
  }
}
