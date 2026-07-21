import { describe, expect, it } from 'vitest';
import { workflowTemplatesService } from './workflowTemplatesService';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import {
  MANAGED_CREMATIONS_WORKFLOW_TEMPLATE_ID,
  SECOND_ORG_WORKFLOW_TEMPLATE_ID,
} from './__mocks__/workflowTemplates';

describe('workflowTemplatesService — template loading', () => {
  it("lists Managed Cremations' own template for its organization", async () => {
    const templates = await workflowTemplatesService.list({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(templates.map((t) => t.id)).toEqual([MANAGED_CREMATIONS_WORKFLOW_TEMPLATE_ID]);
  });

  it('resolves the enabled template for a supported case type', async () => {
    const template = await workflowTemplatesService.getEnabledForCaseType(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      'cremation',
    );
    expect(template?.id).toBe(MANAGED_CREMATIONS_WORKFLOW_TEMPLATE_ID);
  });

  it('returns null for a case type the organization has no enabled template for', async () => {
    const template = await workflowTemplatesService.getEnabledForCaseType(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      'burial',
    );
    expect(template).toBeNull();
  });
});

describe('workflowTemplatesService — organization isolation', () => {
  it("does not return Managed Cremations' template when queried under a different organizationId", async () => {
    const templates = await workflowTemplatesService.list({ organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(templates.map((t) => t.id)).not.toContain(MANAGED_CREMATIONS_WORKFLOW_TEMPLATE_ID);
  });

  it("returns the second organization's own, differently-shaped template under its own context", async () => {
    const templates = await workflowTemplatesService.list({ organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(templates.map((t) => t.id)).toEqual([SECOND_ORG_WORKFLOW_TEMPLATE_ID]);
    expect(templates[0].caseTypes).toEqual(['burial']);
    expect(templates[0].versions[0].stages).toHaveLength(3); // vs. Managed Cremations' 8 raw stages
  });

  it('a mismatched organizationId returns an empty list, not a cross-tenant leak', async () => {
    const templates = await workflowTemplatesService.list({ organizationId: 'some-other-org' });
    expect(templates).toEqual([]);
  });
});
