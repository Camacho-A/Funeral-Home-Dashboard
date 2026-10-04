'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useDocumentTemplates, useCloneDocumentTemplate, useArchiveDocumentTemplate, useRestoreDocumentTemplate } from '@/hooks/useDocumentTemplates';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowMenu, type RowMenuItem } from '@/components/ui/RowMenu';
import { DOCUMENT_TEMPLATE_CATEGORY_LABEL } from '@/domain/documents/documentTypeRegistry';
import { getDocumentTypeDefinition } from '@/domain/documents/documentTypeRegistry';
import type { DocumentTemplate, DocumentTemplateCategory } from '@/types/documentTemplate';
import { DocumentTemplateEditorModal } from './DocumentTemplateEditorModal';

/**
 * Phase 25 (Document Generation & Template Management). "Settings >
 * Document Templates" — orchestration layer, matching
 * `TeamManagementPanel.tsx`'s pattern: owns the editor-open/editing-target
 * state and the category/status filters; gates create/edit/duplicate/
 * archive actions on `document.template.manage`, view on
 * `document.template.read`, via the existing `useMyPermissions` (no new
 * permission hook — see ADR-029 §Permissions).
 *
 * SOLIS Final Phase §7 (2026-10): renders its own `.sx-page-header` now
 * (title/description/"+ New Template" action) — the page wrapper
 * (app/(portal)/settings/document-templates/page.tsx) no longer renders a
 * separate `<h1>`, so the header/action stay driven by this component's
 * own `canManage`/`openCreate`, unchanged. The Status filter stays a
 * native `<select aria-label="Status">` (not the segmented radiogroup
 * design 5c shows) because DocumentTemplateLibraryPanel.test.tsx queries
 * it via `getByLabelText('Status')` — see §7's own "if tests rely on
 * SelectField aria-label='Status', keep the native select" escape hatch.
 * Duplicate/Archive/Restore moved into a `RowMenu` per §7's table spec;
 * Edit stays a standalone visible action. Every hook/handler/mutation/
 * permission gate below is unchanged from before this phase.
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
  const hasActiveFilter = categoryFilter !== '' || statusFilter !== 'active';

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
      <div className="sx-page-header">
        <div>
          <h1 className="sx-page-title">Document templates</h1>
          <p className="sx-page-desc">Templates used to generate case documents and statements.</p>
        </div>
        {canManage && (
          <div className="sx-page-actions">
            <button type="button" className="sx-btn sx-btn-primary" onClick={openCreate}>
              + New Template
            </button>
          </div>
        )}
      </div>

      <div className="sx-filterbar">
        <label className="sx-filter">
          <span className="sx-filter-label">Category</span>
          <SelectField
            className="sx-select"
            style={{ width: 180 }}
            aria-label="Category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as DocumentTemplateCategory | '')}
          >
            <option value="">All categories</option>
            {Object.entries(DOCUMENT_TEMPLATE_CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </label>
        <label className="sx-filter">
          <span className="sx-filter-label">Status</span>
          <SelectField className="sx-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'active' | 'archived' | '')}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="">All</option>
          </SelectField>
        </label>
      </div>

      {templates.length === 0 ? (
        <>
          <EmptyState message="No document templates match these filters." />
          {hasActiveFilter && (
            <button
              type="button"
              className="sx-btn sx-btn-secondary"
              onClick={() => {
                setCategoryFilter('');
                setStatusFilter('');
              }}
            >
              Show all templates
            </button>
          )}
        </>
      ) : (
        <div className="sx-table-wrap">
          <table className="sx-table sx-table-stack">
            <thead>
              <tr>
                <th>Template</th>
                <th>Document type</th>
                <th>Category</th>
                <th>Version</th>
                <th>Status</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const latestVersion = template.versions[template.versions.length - 1];
                const typeLabel = getDocumentTypeDefinition(template.documentTypeKey)?.displayName ?? template.documentTypeKey;
                const isActive = template.status === 'active';
                const menuItems: RowMenuItem[] = [
                  {
                    label: 'Duplicate…',
                    onSelect: () => {
                      const name = window.prompt('Name for the duplicate:', `Copy of ${template.name}`);
                      if (name && name.trim()) cloneTemplate.mutate({ sourceTemplateId: template.id, name: name.trim() });
                    },
                  },
                  isActive
                    ? { label: 'Archive', danger: true, dividerBefore: true, onSelect: () => archiveTemplate.mutate(template.id) }
                    : { label: 'Restore', dividerBefore: true, onSelect: () => restoreTemplate.mutate(template.id) },
                ];
                return (
                  <tr key={template.id}>
                    <td data-label="Template" data-primary className="sx-cell-title">
                      {template.name}
                    </td>
                    <td data-label="Document type">{typeLabel}</td>
                    <td data-label="Category">{DOCUMENT_TEMPLATE_CATEGORY_LABEL[template.category]}</td>
                    <td data-label="Version" className="sx-mono">
                      v{latestVersion.version}
                    </td>
                    <td data-label="Status">
                      <span className={isActive ? 'sx-status sx-status-ok' : 'sx-status'}>{isActive ? 'Active' : 'Archived'}</span>
                    </td>
                    {canManage && (
                      <td>
                        <div className="sx-row-actions">
                          <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" style={{ color: 'var(--sx-link)' }} onClick={() => openEdit(template)}>
                            Edit
                          </button>
                          <RowMenu label={`Actions for ${template.name}`} items={menuItems} />
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage && <DocumentTemplateEditorModal open={editorOpen} onClose={() => setEditorOpen(false)} organizationId={organizationId} editingTemplate={editingTemplate} />}
    </div>
  );
}
