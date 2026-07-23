'use client';

import { useState } from 'react';
import { useWorkflowTemplates } from '@/hooks/useWorkflowTemplates';
import { WorkflowTemplateList } from '@/components/settings/WorkflowTemplateList';
import { WorkflowEditor } from '@/components/settings/WorkflowEditor';
import styles from './page.module.css';

/**
 * Settings page (Phase 18, Workflow Management) — the orchestration layer,
 * matching the pattern every other page in `(portal)/` already follows:
 * this is the only file here that decides which template is selected;
 * WorkflowTemplateList and WorkflowEditor are both presentational/
 * data-fetching-by-id, not route-aware. Activates the Sidebar's previously
 * inert "Settings" entry (see components/layout/Sidebar.tsx) — the first
 * screen to live there.
 *
 * Deliberately generic: nothing here references "Manor," "cremation," or
 * any Managed-Cremations-specific term — this page renders whatever
 * templates the authenticated organization actually has (see
 * useWorkflowTemplates, already organization-scoped since Phase 15B).
 */
export default function SettingsPage() {
  const { data: templates = [], isPending } = useWorkflowTemplates();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const activeTemplateId = selectedTemplateId ?? templates[0]?.id ?? null;

  if (isPending) return <p className={styles.loading}>Loading workflow templates…</p>;

  return (
    <div>
      <h1 className={styles.title}>Settings</h1>
      <div className={styles.columns}>
        <WorkflowTemplateList
          templates={templates.map((t) => ({ id: t.id, name: t.name, isEnabled: t.isEnabled, caseTypes: t.caseTypes }))}
          selectedTemplateId={activeTemplateId}
          onSelect={setSelectedTemplateId}
        />
        {activeTemplateId && <WorkflowEditor key={activeTemplateId} templateId={activeTemplateId} />}
      </div>
    </div>
  );
}
