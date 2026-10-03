'use client';

import { useRef, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { isSignatureRequestsEnabled } from '@/domain/organization/signatureRequestCapability';
import { isDocumentArchivingEnabled } from '@/domain/organization/documentArchiveCapability';
import { useMyPermissions } from '@/hooks/useRbac';
import {
  useCaseDocumentLibrary,
  useUploadCaseDocument,
  useArchiveCaseDocument,
  useBulkDownloadCaseDocuments,
  useBulkPrintCaseDocuments,
} from '@/hooks/useCaseDocumentLibrary';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowMenu, type RowMenuItem } from '@/components/ui/RowMenu';
import { formatTimestamp } from '@/utils/format';
import {
  CASE_DOCUMENT_STATUS_LABEL,
  caseDocumentStatusVariant,
  isCaseDocumentDownloadable,
  isCaseDocumentHistorical,
  isCaseDocumentEligibleForBulkAction,
} from '@/domain/documents/caseDocumentDisplay';
import type { BulkDocumentExclusion } from '@/lib/caseDocumentsClient';
import { getDocumentTypeDefinition } from '@/domain/documents/documentTypeRegistry';
import { buildCaseDocumentDownloadUrl, buildCaseDocumentViewUrl } from '@/lib/caseDocumentsClient';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';
import type { CaseDocument, CaseDocumentWithActorName } from '@/types/caseDocument';
import { GenerateDocumentDialog } from './GenerateDocumentDialog';
import { RequestSignatureDialog } from './RequestSignatureDialog';
import { CaseFormsSection } from './CaseFormsSection';
import { printStoredDocument } from '@/utils/print';

/**
 * Phase 25 (Document Generation & Template Management). The Case Detail
 * page's real, persisted Documents tab — a new tab alongside "Overview"
 * and "Activity" (Phase 24). See git history / prior comments for the
 * full feature history (Print, Print All/Download All, Documents/Forms/
 * History sub-tabs, Documents/History separation) — all unchanged by this
 * pass.
 *
 * SOLIS Tasks/Calendar/Settings phase, Addendum (Case Detail → Documents),
 * supersedes the previous Documents markup entirely: `.sx-docs`/`.sx-doc-row`
 * from styles/solis-documents.css. Every row action except the desktop
 * "View" link now lives inside a `RowMenu` (Download/Print/Regenerate/
 * Request signature/Archive) — the same existing handlers, mutations,
 * permission/capability gates and confirm dialogs, just reachable through
 * "More actions for {fileName}" instead of a row of separate buttons.
 * "View" is included as BOTH the always-visible inline desktop link AND
 * the RowMenu's first item (the CSS contract hides the inline link below
 * 860px) — the same redundant-but-harmless dual-entry-point pattern the
 * previous phase used for Schedule's mobile Confirm action. RowMenu's
 * `href` items render a plain `<a>` with no `target`, so View uses
 * `onSelect: () => window.open(url, '_blank', 'noopener,noreferrer')`
 * instead, to keep its open-in-new-tab behavior identical on both entry
 * points without modifying the shared RowMenu component.
 */
export function CaseDocumentsTab({ caseId, caseName, caseNumber }: { caseId: string; caseName: string; caseNumber: string }) {
  const { organizationId } = useOrganization();
  const documentsQuery = useCaseDocumentLibrary(organizationId, caseId);
  const myPermissionsQuery = useMyPermissions(organizationId);
  const { data: organizationRecord } = useOrganizationRecord();
  const signatureRequestsEnabled = isSignatureRequestsEnabled(organizationRecord ?? null);
  const upload = useUploadCaseDocument(organizationId, caseId);
  const archive = useArchiveCaseDocument(organizationId, caseId);
  const bulkDownload = useBulkDownloadCaseDocuments(organizationId, caseId);
  const bulkPrint = useBulkPrintCaseDocuments(organizationId, caseId, caseName, caseNumber);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [subTab, setSubTab] = useState<'documents' | 'forms' | 'history'>('documents');

  const [generateOpen, setGenerateOpen] = useState(false);
  const [regeneratingDoc, setRegeneratingDoc] = useState<CaseDocument | null>(null);
  const [archivingDoc, setArchivingDoc] = useState<CaseDocument | null>(null);
  const [requestingSignatureFor, setRequestingSignatureFor] = useState<CaseDocument | null>(null);
  const [printingDocId, setPrintingDocId] = useState<string | null>(null);
  const [printError, setPrintError] = useState<{ docId: string; message: string } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkExcluded, setBulkExcluded] = useState<{ action: 'Print All' | 'Download All'; items: BulkDocumentExclusion[] } | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);

  async function handleDownloadAll() {
    setBulkError(null);
    setBulkExcluded(null);
    try {
      const { excluded } = await bulkDownload.mutateAsync();
      if (excluded.length > 0) setBulkExcluded({ action: 'Download All', items: excluded });
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : 'Failed to download all documents.');
    }
  }

  async function handlePrintAll() {
    setBulkError(null);
    setBulkExcluded(null);
    try {
      const { excluded } = await bulkPrint.mutateAsync();
      if (excluded.length > 0) setBulkExcluded({ action: 'Print All', items: excluded });
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : 'Failed to print all documents.');
    }
  }

  async function handlePrint(doc: CaseDocument) {
    setPrintError(null);
    setPrintingDocId(doc.id);
    try {
      await printStoredDocument(buildCaseDocumentDownloadUrl(organizationId, caseId, doc.id), doc.fileName, caseName, caseNumber);
    } catch (error) {
      setPrintError({ docId: doc.id, message: error instanceof Error ? error.message : 'Failed to print this document.' });
    } finally {
      setPrintingDocId(null);
    }
  }

  function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setUploadingFileName(file.name);
      upload.mutate({ file }, { onSettled: () => setUploadingFileName(null) });
    }
    e.target.value = '';
  }

  if (documentsQuery.isPending) {
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '90%' }} />
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sx-skeleton" style={{ width: '80%' }} />
        <span className="sr-only">Loading documents…</span>
      </div>
    );
  }
  if (documentsQuery.isError) {
    return (
      <div className="sx-error-state" role="alert">
        Couldn&rsquo;t load documents. Please try again.
      </div>
    );
  }

  const permissions = myPermissionsQuery.isSuccess ? myPermissionsQuery.data.permissions : null;
  const canGenerate = permissions === null || permissions.includes('document.generate');
  const canUpload = permissions === null || permissions.includes('document.upload');
  const canArchive = (permissions === null || permissions.includes('document.archive')) && isDocumentArchivingEnabled(organizationId);
  const canRequestSignature = (permissions === null || permissions.includes('signature.request')) && signatureRequestsEnabled;

  const documents = documentsQuery.data ?? [];
  const currentDocuments = documents.filter((doc) => !isCaseDocumentHistorical(doc.status));
  const historicalDocuments = documents.filter((doc) => isCaseDocumentHistorical(doc.status));
  const generatedDocuments = currentDocuments.filter((doc) => doc.origin === 'generated');
  const uploadedDocuments = currentDocuments.filter((doc) => doc.origin !== 'generated');
  const eligibleForBulkActions = documents.filter((doc) => isCaseDocumentEligibleForBulkAction(doc.status));
  const hasBulkEligibleDocuments = eligibleForBulkActions.length > 0;

  function statusModifierClass(variant: ReturnType<typeof caseDocumentStatusVariant>): string {
    if (variant === 'success') return 'sx-status-ok';
    if (variant === 'warning') return 'sx-status-warn';
    if (variant === 'danger') return 'sx-status-bad';
    return '';
  }

  function renderDocumentRow(doc: CaseDocumentWithActorName) {
    const typeLabel = doc.documentTypeKey ? (getDocumentTypeDefinition(doc.documentTypeKey)?.displayName ?? doc.documentTypeKey) : 'Uploaded file';
    const canDownload = isCaseDocumentDownloadable(doc.status);
    const canRegenerate = canGenerate && doc.origin === 'generated' && doc.status === 'active';
    const canArchiveThis = canArchive && doc.status === 'active';
    const canRequestSignatureForThis = canRequestSignature && doc.status === 'active' && doc.signatureStatus !== 'signed';
    const viewUrl = buildCaseDocumentViewUrl(organizationId, caseId, doc.id);
    const downloadUrl = buildCaseDocumentDownloadUrl(organizationId, caseId, doc.id);

    const dotIndex = doc.fileName.lastIndexOf('.');
    const rawExt = dotIndex > 0 ? doc.fileName.slice(dotIndex + 1).toLowerCase() : '';
    const ext = rawExt || undefined;
    const extDisplay = rawExt ? rawExt.slice(0, 4).toUpperCase() : 'FILE';

    const statusVariant = caseDocumentStatusVariant(doc.status);
    const statusModifier = statusModifierClass(statusVariant);
    const hasSignatureBadge = doc.signatureStatus !== null;

    const items: RowMenuItem[] = [];
    if (canDownload) {
      items.push({ label: 'View', onSelect: () => window.open(viewUrl, '_blank', 'noopener,noreferrer') });
      items.push({ label: 'Download', href: downloadUrl, onSelect: () => {} });
      items.push({ label: printingDocId === doc.id ? 'Preparing…' : 'Print', onSelect: () => handlePrint(doc), disabled: printingDocId === doc.id });
    }
    if (canRegenerate) {
      items.push({
        label: 'Regenerate',
        onSelect: () => {
          setRegeneratingDoc(doc);
          setGenerateOpen(true);
        },
      });
    }
    if (canRequestSignatureForThis) {
      items.push({ label: 'Request Signature', onSelect: () => setRequestingSignatureFor(doc) });
    }
    if (canArchiveThis) {
      items.push({ label: 'Archive', danger: true, dividerBefore: items.length > 0, onSelect: () => setArchivingDoc(doc) });
    }

    return (
      <div key={doc.id}>
        <div className="sx-doc-row">
          <span className="sx-doc-type" data-ext={ext} aria-hidden="true">
            {extDisplay}
          </span>
          <div className="sx-doc-id">
            <span className="sx-doc-name" title={doc.fileName}>
              {doc.fileName}
            </span>
            <span className="sx-doc-meta">
              {typeLabel}
              {doc.version !== null ? ` · v${doc.version}` : ''} · {doc.origin === 'generated' ? 'Generated' : 'Uploaded'} by {doc.actorDisplayName ?? 'Unknown'} ·{' '}
              {formatTimestamp(doc.createdAt)}
            </span>
          </div>
          <span className="sx-doc-status">
            <span className={`sx-status ${statusModifier}${doc.status === 'active' ? ' sx-doc-status-quiet' : ''}`}>{CASE_DOCUMENT_STATUS_LABEL[doc.status]}</span>
            {hasSignatureBadge && (
              <span className={`sx-status ${doc.signatureStatus === 'signed' ? 'sx-status-ok' : 'sx-status-warn'}`}>
                {doc.signatureStatus === 'signed' ? 'Signed' : 'Awaiting signature'}
              </span>
            )}
          </span>
          <div className="sx-doc-actions">
            {canDownload && (
              <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="sx-btn sx-btn-ghost sx-btn-sm sx-doc-view">
                View
              </a>
            )}
            <RowMenu label={`More actions for ${doc.fileName}`} items={items} />
          </div>
        </div>
        {printError && printError.docId === doc.id && (
          <div className="sx-doc-error" role="alert">
            {printError.message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sx-docs">
      <div className="sx-docs-head">
        <h2 className="sx-docs-title">Documents</h2>
        <div className="sx-seg" role="tablist">
          <button type="button" role="tab" aria-selected={subTab === 'documents'} onClick={() => setSubTab('documents')}>
            Documents
          </button>
          <button type="button" role="tab" aria-selected={subTab === 'forms'} onClick={() => setSubTab('forms')}>
            Forms
          </button>
          <button type="button" role="tab" aria-selected={subTab === 'history'} onClick={() => setSubTab('history')}>
            History
          </button>
        </div>
      </div>

      {subTab === 'forms' && <CaseFormsSection caseId={caseId} />}

      {subTab === 'history' &&
        (historicalDocuments.length === 0 ? (
          <EmptyState message="No superseded or archived documents for this case yet." />
        ) : (
          <section className="sx-docs-group">
            <h3 className="sx-section-title">
              Superseded &amp; archived<span className="sx-section-meta">{historicalDocuments.length} file(s)</span>
            </h3>
            {historicalDocuments.map(renderDocumentRow)}
          </section>
        ))}

      {subTab === 'documents' && (
        <>
          <div className="sx-docs-toolbar">
            {canGenerate && (
              <button
                type="button"
                className="sx-btn sx-btn-secondary"
                onClick={() => {
                  setRegeneratingDoc(null);
                  setGenerateOpen(true);
                }}
              >
                Generate Document
              </button>
            )}
            {canUpload && (
              <>
                <button type="button" className="sx-btn sx-btn-primary" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
                  {upload.isPending ? 'Uploading…' : 'Upload File'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  accept="application/pdf,image/jpeg,image/png,.docx"
                  onChange={handleUploadChange}
                />
              </>
            )}
            <div className="sx-docs-toolbar-spacer" />
            <button
              type="button"
              className="sx-btn sx-btn-ghost"
              onClick={handlePrintAll}
              disabled={!hasBulkEligibleDocuments || bulkPrint.isPending}
              title={hasBulkEligibleDocuments ? undefined : 'No documents are available to print yet.'}
            >
              {bulkPrint.isPending ? 'Preparing…' : 'Print All'}
            </button>
            <button
              type="button"
              className="sx-btn sx-btn-ghost"
              onClick={handleDownloadAll}
              disabled={!hasBulkEligibleDocuments || bulkDownload.isPending}
              title={hasBulkEligibleDocuments ? undefined : 'No documents are available to download yet.'}
            >
              {bulkDownload.isPending ? 'Preparing…' : 'Download All'}
            </button>
          </div>

          {bulkError && (
            <div className="sx-form-banner sx-form-banner-error sx-docs-bulk-note" role="alert">
              {bulkError}
            </div>
          )}
          {bulkExcluded && (
            <div className="sx-form-banner sx-form-banner-info sx-docs-bulk-note" role="status">
              {bulkExcluded.action}: {bulkExcluded.items.length} document{bulkExcluded.items.length === 1 ? '' : 's'} could not be included —{' '}
              {bulkExcluded.items.map((item) => `${item.fileName} (${item.reason})`).join('; ')}
            </div>
          )}

          {currentDocuments.length === 0 ? (
            <EmptyState message="No documents for this case yet." helperText="Upload a file or generate a document from a template." />
          ) : (
            <>
              {generatedDocuments.length > 0 && (
                <section className="sx-docs-group">
                  <h3 className="sx-section-title">
                    Case documents<span className="sx-section-meta">{generatedDocuments.length} file(s)</span>
                  </h3>
                  {generatedDocuments.map(renderDocumentRow)}
                </section>
              )}
              {(uploadedDocuments.length > 0 || uploadingFileName) && (
                <section className="sx-docs-group">
                  <h3 className="sx-section-title">
                    Uploaded files<span className="sx-section-meta">{uploadedDocuments.length} file(s)</span>
                  </h3>
                  {uploadingFileName && (
                    <div className="sx-doc-progress">
                      <span className="sx-doc-type" aria-hidden="true">
                        …
                      </span>
                      <div>
                        <span className="sx-doc-name">Uploading {uploadingFileName}…</span>
                        <div className="sx-doc-progress-bar">
                          <span />
                        </div>
                      </div>
                    </div>
                  )}
                  {uploadedDocuments.map(renderDocumentRow)}
                </section>
              )}
            </>
          )}

          <GenerateDocumentDialog open={generateOpen} onClose={() => setGenerateOpen(false)} organizationId={organizationId} caseId={caseId} regenerating={regeneratingDoc} />

          {requestingSignatureFor && (
            <RequestSignatureDialog
              open
              onClose={() => setRequestingSignatureFor(null)}
              organizationId={organizationId}
              caseId={caseId}
              documentId={requestingSignatureFor.id}
            />
          )}

          {archivingDoc && (
            <ConfirmActionDialog
              open
              onClose={() => setArchivingDoc(null)}
              title="Archive Document"
              message={`"${archivingDoc.fileName}" will be archived and hidden from the active document list. This does not delete it.`}
              confirmLabel="Archive"
              onConfirm={() => archive.mutateAsync(archivingDoc.id)}
            />
          )}
        </>
      )}
    </div>
  );
}
