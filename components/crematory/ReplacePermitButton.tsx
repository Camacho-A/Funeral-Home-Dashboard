'use client';

import { useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { uploadCaseDocument } from '@/lib/caseDocumentsClient';

const PERMIT_TYPE = 'cremation_form.state_permit';

/**
 * Replace Permit (2026-10) — for staff who prepare Crematory Packages, on a
 * case not yet sent. Staff choose the new PDF, then confirm the
 * replacement. The server stores it as the next version naming the permit
 * it replaces (so a duplicate file, or two replacements at once, are
 * refused), keeps the earlier permit as superseded, and clears its
 * confirmation: the new permit must be confirmed before the Crematory
 * Package uses it. Nothing is sent.
 */
export function ReplacePermitButton({
  organizationId,
  caseId,
  decedentDisplayName,
  permit,
  disabled = false,
  onReplaced,
}: {
  organizationId: string;
  caseId: string;
  decedentDisplayName: string;
  permit: { documentId: string; fileName: string };
  disabled?: boolean;
  onReplaced: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setFile(null);
    setError(null);
  };

  async function replace() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadCaseDocument({ organizationId, caseId, file, documentTypeKey: PERMIT_TYPE, replacesDocumentId: permit.documentId });
      close();
      onReplaced();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The permit could not be replaced. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
        Replace permit
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        hidden
        aria-label={`New State Cremation Permit for ${decedentDisplayName}`}
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) setFile(chosen);
          e.target.value = '';
        }}
      />
      {file && (
        <Modal open onClose={() => !busy && close()} title="Replace the State Cremation Permit">
          <div className="sx-modal-header">
            <h2 className="sx-modal-title">Replace the State Cremation Permit</h2>
          </div>
          <div className="sx-modal-body">
            <p>
              Replace <strong>{permit.fileName}</strong> with <strong>{file.name}</strong> for <strong>{decedentDisplayName}</strong>?
            </p>
            <ul>
              <li>The current permit is kept as an earlier version, with its history.</li>
              <li>The new permit must be confirmed before the Crematory Package uses it; until then the package is outdated.</li>
            </ul>
            {error && (
              <div className="sx-form-banner sx-form-banner-error" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="sx-modal-footer">
            <button type="button" className="sx-btn sx-btn-ghost" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="sx-btn sx-btn-primary" onClick={() => void replace()} disabled={busy}>
              {busy ? 'Replacing…' : 'Replace permit'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
