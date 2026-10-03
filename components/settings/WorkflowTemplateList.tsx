'use client';

import { EmptyState } from '@/components/ui/EmptyState';

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
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5: this list has no per-item
 * "version"/"open" columns (that's WorkflowEditor's own version history,
 * not a property of the list item) — per §6, restyled as a simple
 * `.sx-cell-title`/`.sx-status` row list (same shape as RoleList) rather
 * than inventing a table column the real data doesn't have.
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
    <div>
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => onSelect(template.id)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '8px 10px',
            border: 'none',
            borderRadius: 7,
            background: template.id === selectedTemplateId ? 'var(--sx-navy-tint)' : 'transparent',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <div className="sx-cell-title">{template.name}</div>
          <div className="sx-cell-sub">
            {template.caseTypes.join(', ')} · <span className={template.isEnabled ? 'sx-status sx-status-ok' : 'sx-status'}>{template.isEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
