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
import type { WorkflowTemplate } from '@/types/workflowTemplate';

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
 * lib/wixWorkflowTemplateMapper.ts's buildWorkflowTemplate. A template
 * with zero valid versions is excluded from the result (see that module's
 * comment for why); a malformed template or version record is skipped,
 * never thrown on.
 */
async function fetchWixWorkflowTemplates(organizationId: string): Promise<WorkflowTemplate[]> {
  const templatesResponse = await queryWixDataItems<WixWorkflowTemplateItem>('workflowTemplates', {
    filter: { organizationId },
  });

  const summaries = templatesResponse.dataItems
    .map((item) => mapWixWorkflowTemplateItem(item.data))
    .filter((summary) => summary !== null);

  const templates = await Promise.all(
    summaries.map(async (summary) => {
      const versionsResponse = await queryWixDataItems<WixWorkflowTemplateVersionItem>('workflowTemplateVersions', {
        filter: { beaconTemplateId: summary.id },
      });
      const versions = versionsResponse.dataItems
        .map((item) => mapWixWorkflowTemplateVersionItem(item.data))
        .filter((version) => version !== null);

      return buildWorkflowTemplate(summary, versions);
    }),
  );

  return templates.filter((template) => template !== null);
}

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ workflowTemplates: [], error: 'organizationId is required.' }, { status: 400 });
  }

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
