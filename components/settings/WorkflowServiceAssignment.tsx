'use client';

import { Checkbox } from '@/components/ui/Checkbox';
import { useServiceCatalog } from '@/hooks/useServiceCatalog';
import { useWorkflowTemplates } from '@/hooks/useWorkflowTemplates';
import { serviceTypeItems } from '@/domain/pricing/calculateOrder';
import type { WorkflowTemplate } from '@/types/workflowTemplate';
import styles from './WorkflowEditor.module.css';

/**
 * Workflow template editor (2026-10). Which service type(s) this workflow
 * is THE workflow for — only the organization's ACTIVE `service_type`
 * catalog entries can be chosen. Rendered only for an organization with
 * `features.workflowByServiceType`.
 *
 * The choice is saved WITH the draft version and takes effect when that
 * version is approved (never on save). A service another enabled workflow
 * already serves is marked here and refused at approval — at most one
 * enabled workflow per service (domain/workflow/templateValidation.ts).
 */
export function WorkflowServiceAssignment({
  template,
  selected,
  onChange,
}: {
  template: WorkflowTemplate;
  selected: string[];
  onChange: (serviceTypeCodes: string[]) => void;
}) {
  const { data: catalog = [] } = useServiceCatalog();
  const { data: templates } = useWorkflowTemplates();
  const services = serviceTypeItems(catalog);
  const otherHolder = (code: string) =>
    (Array.isArray(templates) ? templates : []).find((t) => t.id !== template.id && t.isEnabled && (t.serviceTypeCodes ?? []).includes(code));
  const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  // Gus Phase 5C-3 (finalization): a service type deactivated after this
  // workflow was assigned to it stays assigned (and can be unassigned); it
  // just can't be newly chosen, and approval needs it active again.
  const inactiveAssigned = catalog.filter((item) => item.category === 'service_type' && !item.isActive && selected.includes(item.serviceCode));
  const unknown = selected.filter(
    (code) => !services.some((item) => item.serviceCode === code) && !inactiveAssigned.some((item) => item.serviceCode === code),
  );

  return (
    <div className={styles.serviceAssignment} data-testid="workflow-service-assignment">
      <div className={styles.sectionLabel}>Service</div>
      <p className={styles.helpText}>
        New cases for the selected service use this workflow once a version with this assignment is approved.
      </p>
      {services.map((item) => {
        const holder = otherHolder(item.serviceCode);
        return (
          <div key={item.serviceCode} className={`${styles.intakeFieldToggle} ${styles.serviceToggle}`} onClick={() => toggle(item.serviceCode)}>
            <Checkbox
              checked={selected.includes(item.serviceCode)}
              onChange={() => toggle(item.serviceCode)}
              aria-label={`Serves ${item.displayName}`}
            />
            <span className={styles.serviceText}>
              {item.displayName}
              {holder && <span className={styles.mutedNote}> — served by &ldquo;{holder.name}&rdquo;</span>}
            </span>
          </div>
        );
      })}
      {inactiveAssigned.map((item) => (
        <div key={item.serviceCode} className={`${styles.intakeFieldToggle} ${styles.serviceToggle}`} onClick={() => toggle(item.serviceCode)}>
          <Checkbox checked onChange={() => toggle(item.serviceCode)} aria-label={`Serves ${item.displayName} (inactive)`} />
          <span className={styles.serviceText}>
            {item.displayName}
            <span className={styles.mutedNote}> — inactive service: kept on this workflow; reactivate it in Settings › Price Catalog before approving</span>
          </span>
        </div>
      ))}
      {unknown.length > 0 && (
        <p className={styles.mutedNote}>Not an active service type: {unknown.join(', ')}</p>
      )}
    </div>
  );
}
