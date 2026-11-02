'use client';

import { useState } from 'react';
import { useWorkflowTemplates } from '@/hooks/useWorkflowTemplates';
import { WorkflowTemplateList } from '@/components/settings/WorkflowTemplateList';
import { WorkflowEditor } from '@/components/settings/WorkflowEditor';
import { useOrganization } from '@/hooks/useOrganization';
import { isWorkflowApprovalRequired } from '@/domain/workflow/selectWorkflowTemplate';
import { latestApprovedVersion } from '@/domain/workflow/snapshot';
import styles from './WorkflowTemplatesPanel.module.css';

/**
 * Task #11 (2026-09, Settings organization cleanup). Extracted, unchanged,
 * from SettingsHub.tsx's own inline "Workflow Templates" section (Phase 18)
 * so this area gets its own dedicated Settings sub-page — the same
 * "card on the hub -> dedicated route" pattern every other administrative
 * area already follows (Team, Case Numbering, Roles & Permissions,
 * Organization Profile, Resources, ...). No behavior change: still the
 * same useWorkflowTemplates query, the same WorkflowTemplateList/
 * WorkflowEditor pairing, the same selection state shape.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5: renders inside SettingsShell
 * now — own `.sx-settings-head` instead of relying on a page-level `<h1>`.
 */
export function WorkflowTemplatesPanel() {
  const { data: templates = [], isPending: templatesPending } = useWorkflowTemplates();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const activeTemplateId = selectedTemplateId ?? templates[0]?.id ?? null;
  const { organizationId } = useOrganization();
  const approvalRequired = isWorkflowApprovalRequired(organizationId);

  return (
    <div>
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Workflow Templates</h2>
        <p className="sx-settings-desc">
          Manage this organization&rsquo;s workflow stages, checklist items and intake fields. Saving always creates a new version — existing cases keep the version they were created under and are never affected.
          {approvalRequired && ' Each service has its own workflow. A new version is a draft until an administrator approves it; new cases always use the latest approved version.'}
        </p>
      </div>
      {templatesPending ? (
        <div className="sx-loading" aria-busy="true">
          <span className="sx-skeleton" style={{ width: '90%' }} />
          <span className="sx-skeleton" style={{ width: '70%' }} />
          <span className="sr-only">Loading workflow templates…</span>
        </div>
      ) : (
        <div className={styles.columns}>
          <WorkflowTemplateList
            templates={templates.map((t) => ({
              id: t.id,
              name: t.name,
              isEnabled: t.isEnabled,
              caseTypes: t.caseTypes,
              // Service-specific workflows (2026-10): approval status only
              // where approval is required.
              ...(approvalRequired ? { approved: latestApprovedVersion(t) !== null } : {}),
            }))}
            selectedTemplateId={activeTemplateId}
            onSelect={setSelectedTemplateId}
          />
          {activeTemplateId && <WorkflowEditor key={activeTemplateId} templateId={activeTemplateId} />}
        </div>
      )}
    </div>
  );
}
