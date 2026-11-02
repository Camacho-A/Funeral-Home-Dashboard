'use client';

import { useWorkflowTemplates } from '@/hooks/useWorkflowTemplates';
import { useServiceCatalog } from '@/hooks/useServiceCatalog';
import styles from './CaseWorkflowLabel.module.css';

/**
 * Service-specific workflows (2026-10). Tells staff which service — and
 * therefore which workflow — a case runs on, next to its stage progress.
 * Rendered only for an organization with `features.workflowByServiceType`
 * (the Case Detail page gates it). Reads the case's own snapshot facts
 * (template id/version, service type); the template and service NAMES are
 * looked up for display only.
 */
export function CaseWorkflowLabel({
  workflowTemplateId,
  workflowTemplateVersion,
  serviceTypeCode,
}: {
  workflowTemplateId: string;
  workflowTemplateVersion: number;
  serviceTypeCode: string | null;
}) {
  const { data: templates } = useWorkflowTemplates();
  const { data: catalog = [] } = useServiceCatalog();
  const templateName = templates?.find((t) => t.id === workflowTemplateId)?.name ?? null;
  const serviceName = serviceTypeCode
    ? (catalog.find((item) => item.serviceCode === serviceTypeCode)?.displayName ?? serviceTypeCode)
    : null;

  return (
    <div className={styles.label} data-testid="case-workflow-label">
      <span>
        Service: <strong>{serviceName ?? 'Not recorded'}</strong>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Workflow: <strong>{templateName ?? workflowTemplateId}</strong> (version {workflowTemplateVersion})
      </span>
    </div>
  );
}
