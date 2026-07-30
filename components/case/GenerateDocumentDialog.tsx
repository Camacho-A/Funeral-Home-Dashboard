'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
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
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="generate-doc-template">
            Template
          </label>
          <SelectField
            id="generate-doc-template"
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
          <div className={styles.field}>
            <label className={styles.label} htmlFor="generate-doc-version">
              Template version
            </label>
            <SelectField id="generate-doc-version" value={templateVersion} onChange={(e) => setTemplateVersion(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Current latest (v{selectedTemplate.versions[selectedTemplate.versions.length - 1].version})</option>
              {selectedTemplate.versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </SelectField>
          </div>
        )}

        {error && <span className={styles.error}>{error}</span>}

        {previewHtml !== null && (
          <div className={styles.previewFrame}>
            <div className={styles.previewContent} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        )}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={handlePreview} disabled={!selectedTemplate || preview.isPending}>
            {preview.isPending ? 'Rendering…' : 'Preview'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleGenerate} disabled={!templateId || generate.isPending}>
            {generate.isPending ? 'Generating…' : regenerating ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
