'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useDocumentTemplates, useCloneDocumentTemplate, useArchiveDocumentTemplate, useRestoreDocumentTemplate } from '@/hooks/useDocumentTemplates';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import { DOCUMENT_TEMPLATE_CATEGORY_LABEL } from '@/domain/documents/documentTypeRegistry';
import { getDocumentTypeDefinition } from '@/domain/documents/documentTypeRegistry';
import type { DocumentTemplate, DocumentTemplateCategory } from '@/types/documentTemplate';
import { DocumentTemplateEditorModal } from './DocumentTemplateEditorModal';
import styles from './DocumentTemplateLibraryPanel.module.css';

/**
 * Phase 25 (Document Generation & Template Management). "Settings >
 * Document Templates" — orchestration layer, matching
 * `TeamManagementPanel.tsx`'s pattern: owns the editor-open/editing-target
 * state and the category/status filters; gates create/edit/duplicate/
 * archive actions on `document.template.manage`, view on
 * `document.template.read`, via the existing `useMyPermissions` (no new
 * permission hook — see ADR-029 §Permissions).
 */
export function DocumentTemplateLibraryPanel() {
  const { organizationId } = useOrganization();
  const templatesQuery = useDocumentTemplates(organizationId);
  const myPermissionsQuery = useMyPermissions(organizationId);
  const cloneTemplate = useCloneDocumentTemplate(organizationId);
  const archiveTemplate = useArchiveDocumentTemplate(organizationId);
  const restoreTemplate = useRestoreDocumentTemplate(organizationId);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<DocumentTemplateCategory | ''>('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | ''>('active');

  if (templatesQuery.isPending || myPermissionsQuery.isPending) {
    return <p>Loading document templates…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  const canRead = permissions.includes('document.template.read');
  const canManage = permissions.includes('document.template.manage');

  if (!canRead) {
    return <EmptyState message="You don't have access to the document template library for this organization." />;
  }

  const templates = (templatesQuery.data ?? [])
    .filter((t) => !categoryFilter || t.category === categoryFilter)
    .filter((t) => !statusFilter || t.status === statusFilter);

  function openCreate() {
    setEditingTemplate(null);
    setEditorOpen(true);
  }
  function openEdit(template: DocumentTemplate) {
    setEditingTemplate(template);
    setEditorOpen(true);
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <SelectField aria-label="Category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as DocumentTemplateCategory | '')}>
          <option value="">All categories</option>
          {Object.entries(DOCUMENT_TEMPLATE_CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'active' | 'archived' | '')}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="">All</option>
        </SelectField>
        <div className={styles.spacer} />
        {canManage && <Button onClick={openCreate}>+ New Template</Button>}
      </div>

      {templates.length === 0 ? (
        <EmptyState message="No document templates match these filters." />
      ) : (
        <Card className={styles.card}>
          <div className={styles.list}>
            {templates.map((template) => {
              const latestVersion = template.versions[template.versions.length - 1];
              const typeLabel = getDocumentTypeDefinition(template.documentTypeKey)?.displayName ?? template.documentTypeKey;
              return (
                <div key={template.id} className={styles.row}>
                  <div className={styles.identity}>
                    <span className={styles.name}>{template.name}</span>
                    <span className={styles.meta}>
                      {typeLabel} · {DOCUMENT_TEMPLATE_CATEGORY_LABEL[template.category]} · v{latestVersion.version}
                    </span>
                  </div>
                  <Badge variant={template.status === 'active' ? 'success' : 'neutral'}>{template.status === 'active' ? 'Active' : 'Archived'}</Badge>
                  {canManage && (
                    <div className={styles.actions}>
                      <Button variant="secondary" onClick={() => openEdit(template)}>
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const name = window.prompt('Name for the duplicate:', `Copy of ${template.name}`);
                          if (name && name.trim()) cloneTemplate.mutate({ sourceTemplateId: template.id, name: name.trim() });
                        }}
                      >
                        Duplicate
                      </Button>
                      {template.status === 'active' ? (
                        <Button variant="ghost" onClick={() => archiveTemplate.mutate(template.id)}>
                          Archive
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={() => restoreTemplate.mutate(template.id)}>
                          Restore
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {canManage && <DocumentTemplateEditorModal open={editorOpen} onClose={() => setEditorOpen(false)} organizationId={organizationId} editingTemplate={editingTemplate} />}
    </div>
  );
}
