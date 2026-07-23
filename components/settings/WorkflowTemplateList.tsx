'use client';

import { EmptyState } from '@/components/ui/EmptyState';
import styles from './WorkflowTemplateList.module.css';

export type WorkflowTemplateListItem = {
  id: string;
  name: string;
  isEnabled: boolean;
  caseTypes: string[];
};

/**
 * Phase 18 (Workflow Management). Template picker for the Settings page —
 * purely presentational, selection state is owned by the page. No template
 * name or case type here is hardcoded; whatever the organization's own
 * templates are named is what renders.
 */
export function WorkflowTemplateList({
  templates,
  selectedTemplateId,
  onSelect,
}: {
  templates: WorkflowTemplateListItem[];
  selectedTemplateId: string | null;
  onSelect: (templateId: string) => void;
}) {
  if (templates.length === 0) {
    return <EmptyState message="No workflow templates configured for this organization yet." />;
  }

  return (
    <div className={styles.list}>
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          className={`${styles.item} ${template.id === selectedTemplateId ? styles.itemActive : ''}`}
          onClick={() => onSelect(template.id)}
        >
          <div className={styles.name}>{template.name}</div>
          <div className={styles.meta}>
            {template.caseTypes.join(', ')} · {template.isEnabled ? 'Enabled' : 'Disabled'}
          </div>
        </button>
      ))}
    </div>
  );
}
