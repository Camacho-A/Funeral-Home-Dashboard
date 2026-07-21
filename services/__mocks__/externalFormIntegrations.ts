import type { ExternalFormIntegration } from '../../types/externalFormIntegration';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';

/**
 * The "Jotform application completed" checklist item (Managed Cremations'
 * Jotform Application stage) references this record via
 * ChecklistItemTemplate.externalFormIntegrationId, rather than the domain
 * layer knowing anything about JotForm by name — see
 * types/externalFormIntegration.ts.
 */
export const JOTFORM_INTEGRATION_ID = 'integration-jotform-managed-cremations';

export const externalFormIntegrationFixtures: ExternalFormIntegration[] = [
  {
    id: JOTFORM_INTEGRATION_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    provider: 'jotform',
    label: 'JotForm intake application',
  },
];
