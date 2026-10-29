'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { crematoryCaseAction } from '@/lib/crematoryClient';
import { caseDocumentsKey } from '@/hooks/useCaseDocumentLibrary';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { isSignatureRequestsEnabled } from '@/domain/organization/signatureRequestCapability';
import { isDocumentArchivingAdministratorsOnly, isDocumentArchivingEnabled } from '@/domain/organization/documentArchiveCapability';
import { useMyPermissions } from '@/hooks/useRbac';
import {
  useCaseDocumentLibrary,
  useUploadCaseDocument,
  useArchiveCaseDocument,
  useBulkDownloadCaseDocuments,
  useBulkPrintCaseDocuments,
  useGenerateOfficialCaseDocument,
  useArrangementExtracts,
  useExtractArrangementPage,
} from '@/hooks/useCaseDocumentLibrary';
import { PermitConfirmationRequiredError, type ArrangementExtractKind } from '@/lib/caseDocumentsClient';
import { officialDocumentsFor, type OfficialDocumentKind } from '@/domain/documents/officialDocumentTriggers';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowMenu, type RowMenuItem } from '@/components/ui/RowMenu';
import { formatTimestamp } from '@/utils/format';
import {
  CASE_DOCUMENT_STATUS_LABEL,
  caseDocumentStatusVariant,
  isCaseDocumentDownloadable,
  isCaseDocumentHistorical,
  isFailedDocumentResolvedByLaterSuccess,
  isCaseDocumentEligibleForBulkAction,
} from '@/domain/documents/caseDocumentDisplay';
import type { BulkDocumentExclusion } from '@/lib/caseDocumentsClient';
import { getDocumentTypeDefinition, UPLOADABLE_DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import { buildCaseDocumentDownloadUrl, buildCaseDocumentViewUrl } from '@/lib/caseDocumentsClient';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';
import { RemoveDocumentDialog } from './RemoveDocumentDialog';
import type { CaseDocument, CaseDocumentWithActorName } from '@/types/caseDocument';
import { GenerateDocumentDialog } from './GenerateDocumentDialog';
import { RequestSignatureDialog } from './RequestSignatureDialog';
import { CaseFormsSection } from './CaseFormsSection';
import { CrematoryPackageStatus } from './CrematoryPackageStatus';
import { sendToCrematoryConfig } from '@/domain/crematory/crematorySettings';
import { Modal } from '@/components/ui/Modal';
import { DocumentPreview } from '@/components/documents/DocumentPreview';
import { printStoredDocument } from '@/utils/print';
import { PrintLabelDialog } from './PrintLabelDialog';
import { ManateeApplicationDialog } from './ManateeApplicationDialog';
import { isCremationLabelDocument } from '@/domain/labels/cremationLabel';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';

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
  /** Envelope / Certificate of Cremation (2026-10): generated automatically,
      and on demand here for older cases or after a failure. */
  const generateOfficial = useGenerateOfficialCaseDocument(organizationId, caseId);
  const officialKinds = officialDocumentsFor(organizationId);
  const [officialError, setOfficialError] = useState<string | null>(null);
  const [officialPending, setOfficialPending] = useState<OfficialDocumentKind | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [subTab, setSubTab] = useState<'documents' | 'forms' | 'history'>('documents');

  const [generateOpen, setGenerateOpen] = useState(false);
  const [regeneratingDoc, setRegeneratingDoc] = useState<CaseDocument | null>(null);
  const [archivingDoc, setArchivingDoc] = useState<CaseDocument | null>(null);
  const [requestingSignatureFor, setRequestingSignatureFor] = useState<CaseDocument | null>(null);
  const [printingDocId, setPrintingDocId] = useState<string | null>(null);
  /**
   * In-app document viewer (2026-10). "View" used to open the inline
   * download URL as a top-level navigation. That is correct HTTP — the
   * route already sends `Content-Disposition: inline` with the stored
   * `application/pdf` — but Chrome's "Download PDFs instead of
   * automatically opening them" setting overrides inline, so View saved
   * the file and handed it to Preview instead of showing it.
   *
   * An <object> embed was tried next and does NOT help: that setting also
   * makes Chrome refuse to render a PDF inside an embed, which is what
   * produced the "This file can't be displayed in the browser" fallback.
   * Since no response header can beat a client setting, SOLIS now renders
   * PDFs itself — see components/documents/DocumentPreview.tsx.
   */
  const [viewingDoc, setViewingDoc] = useState<{ id: string; fileName: string; mimeType: string | null; url: string } | null>(null);
  const [printError, setPrintError] = useState<{ docId: string; message: string } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkExcluded, setBulkExcluded] = useState<{ action: 'Print All' | 'Download All'; items: BulkDocumentExclusion[] } | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);
  const [uploadTypeKey, setUploadTypeKey] = useState('');
  /** Cremation Label (2026-10): the label dialog — for the case (null id)
      or for one saved version from a row. */
  const [labelDialog, setLabelDialog] = useState<{ documentId?: string } | null>(null);
  const labelsEnabled = getRegisteredOrganizationProfile(organizationId).features.dymoCaseLabel;
  /** Manatee County — Death Certificate Application (2026-10). */
  const manateeEnabled = getRegisteredOrganizationProfile(organizationId).features.manateeDeathCertificateApplication;
  const [manateeOpen, setManateeOpen] = useState(false);
  /** ME Form / Crematory Form (2026-10): pages 2 and 3 of the case's
      Arrangement Forms PDF, each saved as its own document. */
  const extractsEnabled = getRegisteredOrganizationProfile(organizationId).features.arrangementPageExtracts;
  const extracts = useArrangementExtracts(organizationId, caseId, extractsEnabled);
  const extract = useExtractArrangementPage(organizationId, caseId);
  const [extractPending, setExtractPending] = useState<ArrangementExtractKind | null>(null);
  const [extractNotice, setExtractNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmingPermit, setConfirmingPermit] = useState(false);

  async function runExtract(kind: ArrangementExtractKind, permitVerifiedByStaff = false) {
    const name = kind === 'me_form' ? 'Release Form' : 'Crematory Form';
    setExtractNotice(null);
    setExtractPending(kind);
    try {
      const result = await extract.mutateAsync({ kind, permitVerifiedByStaff });
      setExtractNotice({
        ok: true,
        message:
          result.outcome === 'saved'
            ? `${name} v${result.version ?? 1} saved to this case's Documents.`
            : `The ${name} is already up to date — the Arrangement Form has not changed since it was extracted.`,
      });
    } catch (error) {
      if (error instanceof PermitConfirmationRequiredError) setConfirmingPermit(true);
      else setExtractNotice({ ok: false, message: error instanceof Error ? error.message : `The ${name} could not be extracted.` });
    } finally {
      setExtractPending(null);
    }
  }

  /**
   * Extract Crematory Form with Send to Crematory (2026-10): the same
   * automatic preparation — page 3 from the Arrangement Form alone (no
   * permit needed), nothing new when it is already current, a new version
   * when the Arrangement Form changed; the original is only read. The
   * Crematory Package is brought up to date too when everything it needs is
   * confirmed. Nothing is sent.
   */
  const queryClient = useQueryClient();
  const preparesWithCrematory = sendToCrematoryConfig(organizationId) !== null;
  async function prepareCrematoryForm() {
    setExtractNotice(null);
    setExtractPending('crematory_form');
    try {
      const { result } = (await crematoryCaseAction(organizationId, caseId, { action: 'prepare' })) as {
        result: { crematoryForm: 'saved' | 'unchanged' | 'no_arrangement_form' | 'not_needed' | 'failed'; package: string };
      };
      const packageNote = result.package === 'saved' ? ' The Crematory Package was updated to match.' : '';
      const notice: Record<typeof result.crematoryForm, { ok: boolean; message: string }> = {
        saved: { ok: true, message: `Crematory Form (Arrangement Form page 3) saved to this case's Documents.${packageNote}` },
        unchanged: { ok: true, message: `The Crematory Form is already up to date — the Arrangement Form has not changed since page 3 was extracted.${packageNote}` },
        no_arrangement_form: {
          ok: false,
          message: "This case has no Arrangement Form PDF yet, so nothing was extracted. If it was uploaded without a document type, choose it in Send to Crematory.",
        },
        not_needed: { ok: false, message: 'Nothing was extracted: this case was already sent to the crematory (or is being sent, or is not a cremation case), so its documents are not changed here.' },
        failed: { ok: false, message: 'Page 3 could not be extracted. Nothing was changed. Please try again.' },
      };
      setExtractNotice(notice[result.crematoryForm] ?? notice.failed);
    } catch (error) {
      setExtractNotice({ ok: false, message: error instanceof Error ? error.message : 'Page 3 could not be extracted. Nothing was changed. Please try again.' });
    } finally {
      setExtractPending(null);
      // The Documents list and the Crematory Package panel reload in the background.
      void queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, caseId) });
      void queryClient.invalidateQueries({ queryKey: ['crematory', organizationId] });
    }
  }

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
      // Send to Crematory organizations choose the document type (2026-10):
      // a State Cremation Permit goes through the server's permit rules, an
      // Arrangement Form has page 3 prepared from it.
      const documentTypeKey = preparesWithCrematory && uploadTypeKey ? uploadTypeKey : undefined;
      upload.mutate({ file, documentTypeKey }, { onSettled: () => setUploadingFileName(null), onSuccess: () => setUploadTypeKey('') });
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
  // 2026-10: where archiving is the administrators-only "Remove", it is
  // offered only once the permissions have loaded and show an administrator.
  const removeIsAdministratorsOnly = isDocumentArchivingAdministratorsOnly(organizationId);
  const canArchive =
    (permissions === null || permissions.includes('document.archive')) &&
    isDocumentArchivingEnabled(organizationId) &&
    (!removeIsAdministratorsOnly || (permissions?.includes('organization.manage') ?? false));
  const canRequestSignature = (permissions === null || permissions.includes('signature.request')) && signatureRequestsEnabled;

  const documents = documentsQuery.data ?? [];
  // A failed generation stays in the primary list only while it is the
  // latest word on that document; once a later attempt succeeded it is
  // unactionable and belongs with the record. See
  // isFailedDocumentResolvedByLaterSuccess.
  const isHistorical = (doc: (typeof documents)[number]) =>
    isCaseDocumentHistorical(doc.status) || isFailedDocumentResolvedByLaterSuccess(doc, documents);
  const currentDocuments = documents.filter((doc) => !isHistorical(doc));
  const historicalDocuments = documents.filter(isHistorical);
  const generatedDocuments = currentDocuments.filter((doc) => doc.origin === 'generated');
  const uploadedDocuments = currentDocuments.filter((doc) => doc.origin !== 'generated');
  const eligibleForBulkActions = documents.filter((doc) => isCaseDocumentEligibleForBulkAction(doc.status));
  const hasBulkEligibleDocuments = eligibleForBulkActions.length > 0;

  /** Everything that creates a document, in one menu (2026-10). */
  const createItems: RowMenuItem[] = [];
  if (canGenerate) {
    createItems.push({
      label: 'Generate Document…',
      onSelect: () => {
        setRegeneratingDoc(null);
        setGenerateOpen(true);
      },
    });
    for (const kind of officialKinds) {
      createItems.push({
        label: kind === 'envelope' ? 'Generate Envelope' : 'Generate Certificate',
        disabled: generateOfficial.isPending,
        onSelect: () => {
          setOfficialError(null);
          setOfficialPending(kind);
          generateOfficial.mutate(kind, {
            onError: (error) => setOfficialError(error instanceof Error ? error.message : 'The document could not be generated.'),
            onSettled: () => setOfficialPending(null),
          });
        },
      });
    }
    if (labelsEnabled) createItems.push({ label: 'Cremation Label…', onSelect: () => setLabelDialog({}) });
    if (manateeEnabled) createItems.push({ label: 'Manatee County — Death Certificate Application…', onSelect: () => setManateeOpen(true) });
    // Every case (2026-10) — a hospital death or anyone who requires it,
    // not only Medical Examiner cases.
    if (extractsEnabled && extracts.data) {
      createItems.push({ label: 'Extract Release Form', dividerBefore: true, disabled: extractPending !== null, onSelect: () => runExtract('me_form') });
    }
    if (extractsEnabled && extracts.data) {
      createItems.push({
        label: 'Extract Crematory Form',
        disabled: extractPending !== null,
        onSelect: () =>
          preparesWithCrematory ? void prepareCrematoryForm() : extracts.data!.permit.confirmed ? runExtract('crematory_form') : setConfirmingPermit(true),
      });
    }
  }
  const createPending =
    officialPending !== null ? 'Generating…' : extractPending === 'crematory_form' && preparesWithCrematory ? 'Preparing…' : extractPending !== null ? 'Extracting…' : null;

  function statusModifierClass(variant: ReturnType<typeof caseDocumentStatusVariant>): string {
    if (variant === 'success') return 'sx-status-ok';
    if (variant === 'warning') return 'sx-status-warn';
    if (variant === 'danger') return 'sx-status-bad';
    return '';
  }

  function renderDocumentRow(doc: CaseDocumentWithActorName) {
    const typeLabel = doc.documentTypeKey ? (getDocumentTypeDefinition(doc.documentTypeKey)?.displayName ?? doc.documentTypeKey) : 'Uploaded file';
    const canDownload = isCaseDocumentDownloadable(doc.status);
    // A saved Cremation Label is viewed and printed through DYMO Connect,
    // never re-made from a template: a new version is saved from the label
    // dialog, and a label is never sent for signature.
    const isLabel = isCremationLabelDocument(doc);
    const canRegenerate = canGenerate && doc.origin === 'generated' && doc.status === 'active' && !isLabel;
    const canArchiveThis = canArchive && doc.status === 'active';
    const canRequestSignatureForThis = canRequestSignature && doc.status === 'active' && doc.signatureStatus !== 'signed' && !isLabel;
    const openView = () =>
      isLabel ? setLabelDialog({ documentId: doc.id }) : setViewingDoc({ id: doc.id, fileName: doc.fileName, mimeType: doc.mimeType, url: viewUrl });
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
      items.push({ label: 'View', onSelect: openView });
      items.push({ label: 'Download', href: downloadUrl, onSelect: () => {} });
      if (isLabel) items.push({ label: 'Print', onSelect: openView });
      else items.push({ label: printingDocId === doc.id ? 'Preparing…' : 'Print', onSelect: () => handlePrint(doc), disabled: printingDocId === doc.id });
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
      items.push({ label: removeIsAdministratorsOnly ? 'Remove' : 'Archive', danger: true, dividerBefore: items.length > 0, onSelect: () => setArchivingDoc(doc) });
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
              <button
                type="button"
                className="sx-btn sx-btn-ghost sx-btn-sm sx-doc-view"
                onClick={openView}
              >
                View
              </button>
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
      {/* In-app viewer (2026-10). An <object> embed, not a navigation, so
          the PDF renders inside SOLIS regardless of the browser's
          "download PDFs" preference. Download stays a separate action for
          when staff actually want the file. */}
      {viewingDoc && (
        <Modal open onClose={() => setViewingDoc(null)} title={viewingDoc.fileName} size="lg">
          <div className="sx-modal-header">
            <h2 className="sx-modal-title">{viewingDoc.fileName}</h2>
            <button type="button" className="sx-icon-btn" aria-label="Close" onClick={() => setViewingDoc(null)}>
              ×
            </button>
          </div>
          <div className="sx-modal-body" style={{ padding: 0 }}>
            <DocumentPreview url={viewingDoc.url} fileName={viewingDoc.fileName} mimeType={viewingDoc.mimeType} />
          </div>
          <div className="sx-modal-footer">
            <a className="sx-btn sx-btn-secondary" href={buildCaseDocumentDownloadUrl(organizationId, caseId, viewingDoc.id)}>
              Download
            </a>
            <button type="button" className="sx-btn sx-btn-primary" onClick={() => setViewingDoc(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

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

      {manateeOpen && <ManateeApplicationDialog organizationId={organizationId} caseId={caseId} onClose={() => setManateeOpen(false)} />}

      {labelDialog && (
        <PrintLabelDialog open onClose={() => setLabelDialog(null)} caseId={caseId} organizationId={organizationId} documentId={labelDialog.documentId} />
      )}

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
          {sendToCrematoryConfig(organizationId) && <CrematoryPackageStatus organizationId={organizationId} caseId={caseId} />}
          <div className="sx-docs-toolbar">
            {/* Toolbar (2026-10): one primary action, every "create a
                document" action in one menu, and the bulk actions together
                on the right — instead of a wrapping row of buttons. */}
            {createItems.length > 0 && (
              <RowMenu label="Create document" triggerLabel={createPending ?? 'Create document'} triggerClassName="sx-btn sx-btn-secondary" align="left" items={createItems} />
            )}
            {canUpload && (
              <>
                {preparesWithCrematory && (
                  <select
                    className="sx-input sx-docs-upload-type"
                    aria-label="Document type for the upload"
                    value={uploadTypeKey}
                    onChange={(e) => setUploadTypeKey(e.target.value)}
                    disabled={upload.isPending}
                  >
                    <option value="">No document type</option>
                    {UPLOADABLE_DOCUMENT_TYPES.map((type) => (
                      <option key={type.key} value={type.key}>
                        {type.displayName}
                      </option>
                    ))}
                  </select>
                )}
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

          {preparesWithCrematory && upload.error && (
            <div className="sx-form-banner sx-form-banner-error sx-docs-bulk-note" role="alert">
              {upload.error.message}
            </div>
          )}

          {extractNotice && (
            <div className={`sx-form-banner ${extractNotice.ok ? 'sx-form-banner-info' : 'sx-form-banner-error'} sx-docs-bulk-note`} role={extractNotice.ok ? 'status' : 'alert'}>
              {extractNotice.message}
            </div>
          )}
          {confirmingPermit && (
            <ConfirmActionDialog
              open
              onClose={() => setConfirmingPermit(false)}
              title="Confirm the permit"
              message="The permit isn't recorded on this case yet (no state approval or “Permit sent to crematory”). Extract the Crematory Form only if you have verified the permit is available. Nothing is sent to the crematory."
              confirmLabel="Permit verified — Extract"
              onConfirm={async () => {
                setConfirmingPermit(false);
                await runExtract('crematory_form', true);
              }}
            />
          )}
          {officialError && (
            <div className="sx-form-banner sx-form-banner-error sx-docs-bulk-note" role="alert">
              {officialError}
            </div>
          )}
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

          {archivingDoc && removeIsAdministratorsOnly && (
            <RemoveDocumentDialog
              fileName={archivingDoc.fileName}
              onClose={() => setArchivingDoc(null)}
              onConfirm={(removal) => archive.mutateAsync({ documentId: archivingDoc.id, removal })}
            />
          )}

          {archivingDoc && !removeIsAdministratorsOnly && (
            <ConfirmActionDialog
              open
              onClose={() => setArchivingDoc(null)}
              title="Archive Document"
              message={`"${archivingDoc.fileName}" will be archived and hidden from the active document list. This does not delete it.`}
              confirmLabel="Archive"
              onConfirm={() => archive.mutateAsync({ documentId: archivingDoc.id })}
            />
          )}
        </>
      )}
    </div>
  );
}
