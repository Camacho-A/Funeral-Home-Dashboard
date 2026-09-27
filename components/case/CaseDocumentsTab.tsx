'use client';

import { useRef, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useCaseDocumentLibrary, useUploadCaseDocument, useArchiveCaseDocument } from '@/hooks/useCaseDocumentLibrary';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import { CASE_DOCUMENT_STATUS_LABEL, caseDocumentStatusVariant } from '@/domain/documents/caseDocumentDisplay';
import { getDocumentTypeDefinition } from '@/domain/documents/documentTypeRegistry';
import { buildCaseDocumentDownloadUrl } from '@/lib/caseDocumentsClient';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';
import type { CaseDocument } from '@/types/caseDocument';
import { GenerateDocumentDialog } from './GenerateDocumentDialog';
import { RequestSignatureDialog } from './RequestSignatureDialog';
import { SignatureStatusPanel } from './SignatureStatusPanel';
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
 * "Print All" is deliberately NOT offered — see this component's own
 * report for why a real multi-document bulk print isn't safely supportable
 * with today's per-document-fetch architecture.
 */
export function CaseDocumentsTab({ caseId, caseName, caseNumber }: { caseId: string; caseName: string; caseNumber: string }) {
  const { organizationId } = useOrganization();
  const documentsQuery = useCaseDocumentLibrary(organizationId, caseId);
  const myPermissionsQuery = useMyPermissions(organizationId);
  const upload = useUploadCaseDocument(organizationId, caseId);
  const archive = useArchiveCaseDocument(organizationId, caseId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [regeneratingDoc, setRegeneratingDoc] = useState<CaseDocument | null>(null);
  const [archivingDoc, setArchivingDoc] = useState<CaseDocument | null>(null);
  const [requestingSignatureFor, setRequestingSignatureFor] = useState<CaseDocument | null>(null);
  const [expandedSignatureId, setExpandedSignatureId] = useState<string | null>(null);
  const [printingDocId, setPrintingDocId] = useState<string | null>(null);
  const [printError, setPrintError] = useState<{ docId: string; message: string } | null>(null);

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
  const canArchive = permissions === null || permissions.includes('document.archive');
  const canRequestSignature = permissions === null || permissions.includes('signature.request');
  const canReadSignature = permissions === null || permissions.includes('signature.read');
  const canCancelSignature = permissions === null || permissions.includes('signature.cancel');

  const documents = documentsQuery.data ?? [];

  return (
    <div className={styles.card}>
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
      </div>

      {documents.length === 0 ? (
        <EmptyState message="No documents for this case yet." />
      ) : (
        <Card className={styles.listCard}>
          <div className={styles.list}>
            {documents.map((doc) => {
              const typeLabel = doc.documentTypeKey ? (getDocumentTypeDefinition(doc.documentTypeKey)?.displayName ?? doc.documentTypeKey) : 'Uploaded file';
              const canDownload = doc.status === 'active' || doc.status === 'superseded' || doc.status === 'archived';
              const canRegenerate = canGenerate && doc.origin === 'generated' && doc.status === 'active';
              const canArchiveThis = canArchive && doc.status === 'active';
              const canRequestSignatureForThis = canRequestSignature && doc.status === 'active' && doc.signatureStatus !== 'signed';
              const isSignatureExpanded = expandedSignatureId === doc.id;

              return (
                <div key={doc.id} className={styles.rowGroup}>
                  <div className={styles.row}>
                    <div className={styles.identity}>
                      <span className={styles.fileName}>{doc.fileName}</span>
                      <span className={styles.meta}>
                        {typeLabel}
                        {doc.version !== null ? ` · v${doc.version}` : ''} · {doc.origin === 'generated' ? 'Generated' : 'Uploaded'} by {doc.generatedBy ?? doc.uploadedBy ?? 'unknown'} ·{' '}
                        {formatTimestamp(doc.createdAt)}
                      </span>
                    </div>
                    <Badge variant={caseDocumentStatusVariant(doc.status)}>{CASE_DOCUMENT_STATUS_LABEL[doc.status]}</Badge>
                    <div className={styles.actions}>
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
                  {canReadSignature && doc.status === 'active' && (
                    <>
                      <button type="button" className={styles.signatureToggle} onClick={() => setExpandedSignatureId(isSignatureExpanded ? null : doc.id)}>
                        {isSignatureExpanded ? 'Hide signature status' : 'Show signature status'}
                      </button>
                      {isSignatureExpanded && (
                        <SignatureStatusPanel
                          organizationId={organizationId}
                          caseId={caseId}
                          documentId={doc.id}
                          canRequest={canRequestSignature}
                          canCancel={canCancelSignature}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
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
    </div>
  );
}
