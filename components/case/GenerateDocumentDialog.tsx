'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SelectField } from '@/components/ui/SelectField';
import { useDocumentTemplates, usePreviewDocumentTemplate } from '@/hooks/useDocumentTemplates';
import { useGenerateCaseDocument } from '@/hooks/useCaseDocumentLibrary';
import type { CaseDocument } from '@/types/caseDocument';
import styles from './GenerateDocumentDialog.module.css';

/**
 * Phase 25 (Document Generation & Template Management). Handles both a
 * fresh generation and a regeneration (when `regenerating` is set) — the
 * version selector defaults to "current latest" but always makes the
 * choice visible, never hides it (see this phase's Invariants: a
 * regeneration targets the same or a newer template version by explicit
 * user choice).
 */
export function GenerateDocumentDialog({
  open,
  onClose,
  organizationId,
  caseId,
  regenerating,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  caseId: string;
  regenerating: CaseDocument | null;
}) {
  const templatesQuery = useDocumentTemplates(organizationId);
  const preview = usePreviewDocumentTemplate(organizationId);
  const generate = useGenerateCaseDocument(organizationId, caseId);

  const [templateId, setTemplateId] = useState('');
  const [templateVersion, setTemplateVersion] = useState<number | ''>('');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTemplateId(regenerating?.templateId ?? '');
    setTemplateVersion('');
    setPreviewHtml(null);
    setError(null);
  }, [open, regenerating]);

  const activeTemplates = (templatesQuery.data ?? []).filter((t) => t.status === 'active');
  const selectedTemplate = activeTemplates.find((t) => t.id === templateId) ?? null;

  async function handlePreview() {
    if (!selectedTemplate) return;
    setError(null);
    try {
      // A specific (non-latest) version's body is resolved client-side
      // (already present in the fetched template) and passed as the ad
      // hoc `body` override, since the preview route's own "no body
      // given" fallback always resolves the template's current latest
      // version, not an arbitrary one.
      const versionBody = templateVersion !== '' ? selectedTemplate.versions.find((v) => v.version === templateVersion)?.body : undefined;
      const html = await preview.mutateAsync({ templateId: selectedTemplate.id, caseId, ...(versionBody !== undefined ? { body: versionBody } : {}) });
      setPreviewHtml(html);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render preview.');
    }
  }

  async function handleGenerate() {
    if (!templateId) return;
    setError(null);
    try {
      await generate.mutateAsync({
        templateId,
        templateVersion: templateVersion === '' ? undefined : templateVersion,
        existingDocumentId: regenerating?.id,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate the document.');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={regenerating ? 'Regenerate Document' : 'Generate Document'}>
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">{regenerating ? 'Regenerate Document' : 'Generate Document'}</h2>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="sx-modal-body">
        <div className="sx-form-grid">
          <div className="sx-span-all sx-field">
            <label className="sx-label sx-label-required" htmlFor="generate-doc-template">
              Template
            </label>
            <SelectField
              id="generate-doc-template"
              className="sx-select"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setTemplateVersion('');
                setPreviewHtml(null);
              }}
              disabled={Boolean(regenerating)}
              required
            >
              <option value="" disabled>
                Select a template…
              </option>
              {activeTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectField>
          </div>

          {selectedTemplate && (
            <div className="sx-span-all sx-field">
              <label className="sx-label" htmlFor="generate-doc-version">
                Template version
              </label>
              <SelectField id="generate-doc-version" className="sx-select" value={templateVersion} onChange={(e) => setTemplateVersion(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Current latest (v{selectedTemplate.versions[selectedTemplate.versions.length - 1].version})</option>
                {selectedTemplate.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
        </div>

        {error && (
          <div className="sx-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        {previewHtml !== null && (
          <div className={styles.previewFrame} style={{ marginTop: 14 }}>
            <div className={styles.previewContent} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        )}
      </div>
      <div className="sx-modal-footer">
        <button type="button" className="sx-btn sx-btn-ghost" onClick={handlePreview} disabled={!selectedTemplate || preview.isPending}>
          {preview.isPending ? 'Rendering…' : 'Preview'}
        </button>
        <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="sx-btn sx-btn-primary" onClick={handleGenerate} disabled={!templateId || generate.isPending}>
          {generate.isPending ? 'Generating…' : regenerating ? 'Regenerate' : 'Generate'}
        </button>
      </div>
    </Modal>
  );
}
