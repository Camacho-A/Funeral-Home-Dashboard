'use client';

import { useServiceCatalog } from '@/hooks/useServiceCatalog';

/**
 * Service-specific workflows (2026-10). Which service type(s) a workflow
 * template serves, by their catalog names — rendered only for an
 * organization with `features.workflowByServiceType`.
 */
export function WorkflowTemplateServiceLine({ serviceTypeCodes }: { serviceTypeCodes: string[] }) {
  const { data: catalog = [] } = useServiceCatalog();
  const names = serviceTypeCodes.map((code) => catalog.find((item) => item.serviceCode === code)?.displayName ?? code);
  return (
    <p className="sx-cell-sub" data-testid="workflow-template-services">
      Service: {names.length > 0 ? names.join(', ') : 'none assigned'}
    </p>
  );
}
