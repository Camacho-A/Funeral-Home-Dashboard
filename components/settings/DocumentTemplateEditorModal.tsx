'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { TextArea } from '@/components/ui/TextArea';
import { SelectField } from '@/components/ui/SelectField';
import { useCreateDocumentTemplate, useCreateDocumentTemplateVersion, usePreviewDocumentTemplate } from '@/hooks/useDocumentTemplates';
import { DOCUMENT_TYPES, getDocumentTypeDefinition } from '@/domain/documents/documentTypeRegistry';
import { MERGE_FIELD_CATALOG } from '@/domain/documents/mergeEngine';
import type { DocumentTemplate } from '@/types/documentTemplate';
import styles from './DocumentTemplateEditorModal.module.css';

const DOCUMENT_TYPE_OPTIONS = Object.values(DOCUMENT_TYPES).sort((a, b) => a.category.localeCompare(b.category) || a.displayName.localeCompare(b.displayName));

/**
 * Phase 25 (Document Generation & Template Management). Create-or-edit
 * modal — editing always creates a new version (never mutates a past
 * one, per this phase's Invariants); a plain sanitized textarea for the
 * body, not a full WYSIWYG dependency (a deliberate scope-limiting
 * choice — see ADR-029). The Merge-Field Browser is a simple
 * searchable/categorized reference list a template author clicks to
 * insert `{{token}}` at the cursor.
 */
export function DocumentTemplateEditorModal({
  open,
  onClose,
  organizationId,
  editingTemplate,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  editingTemplate: DocumentTemplate | null;
}) {
  const createTemplate = useCreateDocumentTemplate(organizationId);
  const createVersion = useCreateDocumentTemplateVersion(organizationId);
  const preview = usePreviewDocumentTemplate(organizationId);

  const [name, setName] = useState('');
  const [documentTypeKey, setDocumentTypeKey] = useState('');
  const [body, setBody] = useState('');
  const [mergeFieldFilter, setMergeFieldFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editingTemplate) {
      setName(editingTemplate.name);
      setDocumentTypeKey(editingTemplate.documentTypeKey);
      setBody(editingTemplate.versions[editingTemplate.versions.length - 1].body);
    } else {
      setName('');
      setDocumentTypeKey('');
      setBody('');
    }
    setError(null);
    setPreviewHtml(null);
  }, [open, editingTemplate]);

  function insertToken(token: string) {
    setBody((current) => `${current}{{${token}}}`);
  }

  async function handlePreview() {
    setError(null);
    try {
      const html = await preview.mutateAsync({ templateId: editingTemplate?.id ?? 'draft', body });
      setPreviewHtml(html);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render preview.');
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim() || !documentTypeKey || !body.trim()) return;
    try {
      if (editingTemplate) {
        await createVersion.mutateAsync({ templateId: editingTemplate.id, body });
      } else {
        const definition = getDocumentTypeDefinition(documentTypeKey);
        if (!definition) return;
        await createTemplate.mutateAsync({ name: name.trim(), documentTypeKey, category: definition.category, body });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the template.');
    }
  }

  const filteredMergeFields = Object.values(MERGE_FIELD_CATALOG).filter(
    (field) => !mergeFieldFilter.trim() || field.displayName.toLowerCase().includes(mergeFieldFilter.toLowerCase()) || field.identifier.toLowerCase().includes(mergeFieldFilter.toLowerCase()),
  );

  const isSaving = createTemplate.isPending || createVersion.isPending;

  return (
    <Modal open={open} onClose={onClose} title={editingTemplate ? `Edit "${editingTemplate.name}"` : 'New Document Template'}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.mainColumn}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="doc-template-name">
              Name
            </label>
            <TextField id="doc-template-name" value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(editingTemplate)} required autoFocus={!editingTemplate} />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="doc-template-type">
              Document type
            </label>
            <SelectField id="doc-template-type" value={documentTypeKey} onChange={(e) => setDocumentTypeKey(e.target.value)} disabled={Boolean(editingTemplate)} required>
              <option value="" disabled>
                Select a document type…
              </option>
              {DOCUMENT_TYPE_OPTIONS.map((def) => (
                <option key={def.key} value={def.key}>
                  {def.displayName}
                </option>
              ))}
            </SelectField>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="doc-template-body">
              Body (click a merge field on the right to insert it)
            </label>
            <TextArea id="doc-template-body" className={styles.bodyTextArea} value={body} onChange={(e) => setBody(e.target.value)} rows={12} required />
          </div>

          {error && <span className={styles.error}>{error}</span>}

          {previewHtml !== null && (
            <div className={styles.previewFrame}>
              <div className={styles.previewLabel}>Preview (sample data)</div>
              <div className={styles.previewContent} dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          )}

          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={handlePreview} disabled={!body.trim() || preview.isPending}>
              {preview.isPending ? 'Rendering…' : 'Preview'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !documentTypeKey || !body.trim() || isSaving}>
              {editingTemplate ? 'Save New Version' : 'Create Template'}
            </Button>
          </div>
        </div>

        <div className={styles.mergeFieldBrowser}>
          <div className={styles.mergeFieldHeader}>Merge fields</div>
          <TextField placeholder="Search…" value={mergeFieldFilter} onChange={(e) => setMergeFieldFilter(e.target.value)} className={styles.mergeFieldSearch} />
          <div className={styles.mergeFieldList}>
            {filteredMergeFields.map((field) => (
              <button
                key={field.identifier}
                type="button"
                className={styles.mergeFieldItem}
                title={field.description}
                onClick={() => insertToken(field.identifier)}
              >
                <span className={styles.mergeFieldName}>{field.displayName}</span>
                <span className={styles.mergeFieldToken}>{`{{${field.identifier}}}`}</span>
                <span className={styles.mergeFieldExample}>e.g. {field.exampleValue}</span>
              </button>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
