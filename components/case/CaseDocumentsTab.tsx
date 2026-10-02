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
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
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
import styles from './CaseDocumentsTab.module.css';

/**
 * Phase 25 (Document Generation & Template Management). The Case Detail
 * page's real, persisted Documents tab — a new tab alongside "Overview"
 * and "Activity" (Phase 24).
 *
 * Item #2 correction (2026-09): the Overview tab's old `DocumentsCard`
 * (mock-only, never wired to a real backend) has been removed — this tab
 * is now the *only* real Documents surface. Its per-document "Print"
 * action (added here) replaces DocumentsCard's Print/Print All, per that
 * item's explicit "add Print option to the tabs instead" — it fetches the
 * real document through the exact same authorized
 * `GET .../documents/[documentId]/download` route "Download" already
 * uses (session-cookie-gated, re-checks `document.view`, never a Blob/
 * signed URL server-side), then prints the fetched bytes via the existing
 * `printFile`-based `printStoredDocument` — never a synthetic placeholder.
 *
 * Task #3 (2026-09): "Print All"/"Download All" — case-level bulk actions
 * for every currently staff-accessible document (the same
 * `isCaseDocumentDownloadable` eligibility individual Download/Print
 * already uses). Both fetch an on-demand artifact from the server
 * (services/documentService.ts#buildBulkDownloadZip/buildBulkPrintPdf) —
 * a ZIP of original bytes, or one combined PDF via pdf-lib page-copy/
 * image-embed — never a new persisted CaseDocument, never the originals
 * altered. See those functions' own doc comments for the full design
 * (why DOCX can't safely join the combined PDF, partial-failure
 * handling, filenames).
 *
 * Task #12 (2026-09, Forms organization). Adds an internal "Documents" /
 * "Forms" sub-tab switcher — CaseFormsSection (external Jotform status/
 * activity: sent/received/reviewed, retry, reconciliation) moved here,
 * unchanged, from its old spot on the Overview tab. It's a distinct
 * concept from the CaseDocument files below (Documents = actual stored
 * files; Forms = status/activity for external submissions, one of which
 * may eventually *produce* a CaseDocument here, via ExternalFormSubmission's
 * own `documentId` link — never a second copy, never a second repository).
 * Purely a presentation move: same component, same caseId prop, same
 * queries/permissions (`case.read`, already required to view this page at
 * all) — switching sub-tabs never mutates anything.
 *
 * Task #12 follow-up (2026-09, Documents/History separation). Adds a
 * third internal sub-tab, "History" — a pure presentation split of the
 * SAME `documentsQuery.data` array by existing `CaseDocument.status`
 * (domain/documents/caseDocumentDisplay.ts#isCaseDocumentHistorical:
 * `superseded` or `archived`), never a second query, never a data
 * mutation. "Documents" now shows only the current working set
 * (`pending`/`active`/`failed` — a failed generation attempt has no
 * usable file and is deliberately NOT treated as a historical PDF, see
 * that function's own doc comment); "History" shows exactly the
 * complement. The same per-row markup (`renderDocumentRow` below) backs
 * both lists — every existing status-gated action (Regenerate/Archive/
 * Request Signature, each already conditioned on `doc.status === 'active'`)
 * is therefore automatically absent from History rows with zero new
 * conditionals, and Download/Print stay exactly as eligible as they
 * always were (`isCaseDocumentDownloadable`, unchanged). Generate
 * Document/Upload File/Print All/Download All remain Documents-only
 * actions — History has no toolbar. Print All/Download All's own
 * eligibility narrows from `isCaseDocumentDownloadable` to
 * `isCaseDocumentEligibleForBulkAction` (excludes `superseded`; keeps
 * `archived`, preserving the separate, earlier document-archiving item
 * #12 precedent) — see that function's own doc comment.
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

  if (documentsQuery.isPending) {
    return <p className={styles.loading}>Loading documents…</p>;
  }
  if (documentsQuery.isError) {
    return <p className={styles.errorText}>Couldn&rsquo;t load documents. Please try again.</p>;
  }

  // GET /api/rbac/my-permissions is identity-mode-only (its own comment:
  // "never itself an authorization decision" — every document action route
  // re-checks authorization server-side regardless). This tab, unlike every
  // other useMyPermissions consumer, lives on the universal Case Detail page
  // rather than an identity-mode-gated settings page, so it must tolerate
  // that endpoint being unavailable (e.g. AUTH_ADAPTER=mock) — the fact that
  // documentsQuery itself succeeded already proves view access; a still-
  // loading or errored permissions query defaults every action to visible
  // rather than incorrectly locking the whole tab.
  const permissions = myPermissionsQuery.isSuccess ? myPermissionsQuery.data.permissions : null;
  const canGenerate = permissions === null || permissions.includes('document.generate');
  const canUpload = permissions === null || permissions.includes('document.upload');
  // Handwritten item #12 (2026-09, Archive removal for Manors). The
  // `document.archive` permission alone is not sufficient — the
  // organization-level capability must also allow it. Manors resolves to
  // disabled here regardless of the caller's own role/permission; the
  // server independently re-enforces the same rule (services/documentService.ts#archive)
  // regardless of what this component renders.
  const canArchive = (permissions === null || permissions.includes('document.archive')) && isDocumentArchivingEnabled(organizationId);
  // Handwritten item #4 (2026-09): gated on both the permission AND the
  // organization-level capability — an organization with Signature
  // Requests disabled (Manors) never shows Request Signature/Resend
  // regardless of the viewer's own signature.request permission.
  const canRequestSignature = (permissions === null || permissions.includes('signature.request')) && signatureRequestsEnabled;

  const documents = documentsQuery.data ?? [];
  // Task #12 follow-up (2026-09, Documents/History separation) — a pure
  // presentation split of the same array by existing status; see this
  // component's own doc comment above.
  const currentDocuments = documents.filter((doc) => !isCaseDocumentHistorical(doc.status));
  const historicalDocuments = documents.filter((doc) => isCaseDocumentHistorical(doc.status));
  // Task #3 (2026-09) — Print All / Download All. Computed over the full
  // document set (not just currentDocuments) via isCaseDocumentEligibleForBulkAction,
  // which deliberately keeps archived documents bulk-eligible even though
  // they now browse under History — see that function's own doc comment.
  const eligibleForBulkActions = documents.filter((doc) => isCaseDocumentEligibleForBulkAction(doc.status));
  const hasBulkEligibleDocuments = eligibleForBulkActions.length > 0;

  function renderDocumentRow(doc: CaseDocumentWithActorName) {
    const typeLabel = doc.documentTypeKey ? (getDocumentTypeDefinition(doc.documentTypeKey)?.displayName ?? doc.documentTypeKey) : 'Uploaded file';
    const canDownload = isCaseDocumentDownloadable(doc.status);
    const canRegenerate = canGenerate && doc.origin === 'generated' && doc.status === 'active';
    const canArchiveThis = canArchive && doc.status === 'active';
    const canRequestSignatureForThis = canRequestSignature && doc.status === 'active' && doc.signatureStatus !== 'signed';

    return (
      <div key={doc.id} className={styles.rowGroup}>
        <div className={styles.row}>
          <div className={styles.identity}>
            <span className={styles.fileName}>{doc.fileName}</span>
            <span className={styles.meta}>
              {typeLabel}
              {doc.version !== null ? ` · v${doc.version}` : ''} · {doc.origin === 'generated' ? 'Generated' : 'Uploaded'} by {doc.actorDisplayName ?? 'Unknown'} ·{' '}
              {formatTimestamp(doc.createdAt)}
            </span>
          </div>
          <Badge variant={caseDocumentStatusVariant(doc.status)}>{CASE_DOCUMENT_STATUS_LABEL[doc.status]}</Badge>
          <div className={styles.actions}>
            {canDownload && (
              <a
                href={buildCaseDocumentViewUrl(organizationId, caseId, doc.id)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.downloadLink}
              >
                View
              </a>
            )}
            {canDownload && (
              <a href={buildCaseDocumentDownloadUrl(organizationId, caseId, doc.id)} className={styles.downloadLink}>
                Download
              </a>
            )}
            {canDownload && (
              <Button variant="secondary" onClick={() => handlePrint(doc)} disabled={printingDocId === doc.id}>
                {printingDocId === doc.id ? 'Preparing…' : 'Print'}
              </Button>
            )}
            {canRegenerate && (
              <Button
                variant="secondary"
                onClick={() => {
                  setRegeneratingDoc(doc);
                  setGenerateOpen(true);
                }}
              >
                Regenerate
              </Button>
            )}
            {canRequestSignatureForThis && (
              <Button variant="secondary" onClick={() => setRequestingSignatureFor(doc)}>
                Request Signature
              </Button>
            )}
            {canArchiveThis && (
              <Button variant="ghost" onClick={() => setArchivingDoc(doc)}>
                Archive
              </Button>
            )}
          </div>
        </div>
        {printError && printError.docId === doc.id && (
          <div className={styles.errorText} role="alert">
            {printError.message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.subTabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'documents'}
          className={subTab === 'documents' ? styles.subTabActive : styles.subTabInactive}
          onClick={() => setSubTab('documents')}
        >
          Documents
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'forms'}
          className={subTab === 'forms' ? styles.subTabActive : styles.subTabInactive}
          onClick={() => setSubTab('forms')}
        >
          Forms
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'history'}
          className={subTab === 'history' ? styles.subTabActive : styles.subTabInactive}
          onClick={() => setSubTab('history')}
        >
          History
        </button>
      </div>

      {subTab === 'forms' && <CaseFormsSection caseId={caseId} />}

      {subTab === 'history' && (
        historicalDocuments.length === 0 ? (
          <EmptyState message="No superseded or archived documents for this case yet." />
        ) : (
          <Card className={styles.listCard}>
            <div className={styles.list}>{historicalDocuments.map(renderDocumentRow)}</div>
          </Card>
        )
      )}

      {subTab === 'documents' && (
      <>
      <div className={styles.toolbar}>
        {canGenerate && (
          <Button
            onClick={() => {
              setRegeneratingDoc(null);
              setGenerateOpen(true);
            }}
          >
            Generate Document
          </Button>
        )}
        {canUpload && (
          <>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? 'Uploading…' : 'Upload File'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className={styles.hiddenFileInput}
              accept="application/pdf,image/jpeg,image/png,.docx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate({ file });
                e.target.value = '';
              }}
            />
          </>
        )}
        <Button
          variant="secondary"
          onClick={handlePrintAll}
          disabled={!hasBulkEligibleDocuments || bulkPrint.isPending}
          title={hasBulkEligibleDocuments ? undefined : 'No documents are available to print yet.'}
        >
          {bulkPrint.isPending ? 'Preparing…' : 'Print All'}
        </Button>
        <Button
          variant="secondary"
          onClick={handleDownloadAll}
          disabled={!hasBulkEligibleDocuments || bulkDownload.isPending}
          title={hasBulkEligibleDocuments ? undefined : 'No documents are available to download yet.'}
        >
          {bulkDownload.isPending ? 'Preparing…' : 'Download All'}
        </Button>
      </div>

      {bulkError && (
        <div className={styles.errorText} role="alert">
          {bulkError}
        </div>
      )}
      {bulkExcluded && (
        <div className={styles.errorText} role="status">
          {bulkExcluded.action}: {bulkExcluded.items.length} document{bulkExcluded.items.length === 1 ? '' : 's'} could not be included —{' '}
          {bulkExcluded.items.map((item) => `${item.fileName} (${item.reason})`).join('; ')}
        </div>
      )}

      {currentDocuments.length === 0 ? (
        <EmptyState message="No documents for this case yet." />
      ) : (
        <Card className={styles.listCard}>
          <div className={styles.list}>{currentDocuments.map(renderDocumentRow)}</div>
        </Card>
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
