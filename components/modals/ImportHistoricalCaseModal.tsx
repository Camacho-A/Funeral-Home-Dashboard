'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import {
  useExternalFormConfigs,
  usePreviewHistoricalCase,
  useCreateHistoricalCase,
} from '@/hooks/useExternalForms';
import { Modal } from '@/components/ui/Modal';
import { formatTimestamp } from '@/utils/format';

/**
 * Manors Jotform integration — historical CASE creation (2026-09). An
 * administrative migration action, deliberately separate from the normal
 * "+ New Case" workflow — for the two known real historical Arrangement
 * Forms submissions that predate any Solis case existing at all.
 *
 * INFORMANT vs NEXT OF KIN (authoritative, 2026-09 audit): the Informant
 * section below is reference-only. There is no "use as Next of Kin"
 * button anywhere in this component, deliberately — Next of Kin name and
 * phone are always typed by the staff member, never derived from
 * Informant data.
 *
 * The eventual case number is never predicted or displayed before
 * creation — only after a real case is actually created, from that
 * case's own real, server-assigned caseNumber.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5: modal shell + form system.
 * "Look up" and the footer's "Cancel" are the spec's own literal labels
 * (previously "Look Up"/"Close") — ImportHistoricalCaseModal.test.tsx's
 * "Look Up" queries updated to "Look up" (see this fork's report); no
 * test asserted "Close" by name, so that rename is test-safe as-is.
 */
export function ImportHistoricalCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { organizationId } = useOrganization();
  const configsQuery = useExternalFormConfigs(organizationId, open);
  const preview = usePreviewHistoricalCase(organizationId);
  const create = useCreateHistoricalCase(organizationId);

  const [formConfigId, setFormConfigId] = useState('');
  const [submissionId, setSubmissionId] = useState('');
  const [nextOfKinName, setNextOfKinName] = useState('');
  const [nextOfKinPhone, setNextOfKinPhone] = useState('');
  const [result, setResult] = useState<{ alreadyImported: boolean; caseId: string | null; caseNumber: string | null } | null>(null);

  function reset() {
    setFormConfigId('');
    setSubmissionId('');
    setNextOfKinName('');
    setNextOfKinPhone('');
    setResult(null);
    preview.reset();
    create.reset();
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleLookUp() {
    setResult(null);
    await preview.mutateAsync({ formConfigId, externalSubmissionId: submissionId.trim() });
  }

  /**
   * Task #20 (2026-09, close import window after success). A confirmed
   * successful creation (a genuinely new case, `!alreadyImported`) closes
   * the window automatically — tied to the mutation's own resolution, not
   * a timer — reusing handleClose()'s existing reset()+onClose() so the
   * next open starts from the same clean state the manual "Close" button
   * already produced. `create.mutateAsync` rejects on failure, so this
   * line is only ever reached on success; failures fall through to the
   * catch below, where the window is deliberately left open (create.isError
   * renders the existing error message, and the user's typed Next of
   * Kin/submission ID stay exactly as entered for a retry).
   *
   * The duplicate-protection "already imported" outcome is NOT an error —
   * the mutation resolves normally — but it also created nothing new, so
   * it keeps the prior behavior of showing the informational message and
   * waiting for a manual Close, rather than instantly closing over text
   * the user hasn't had a chance to read.
   */
  async function handleCreate() {
    try {
      const outcome = await create.mutateAsync({
        formConfigId,
        externalSubmissionId: submissionId.trim(),
        nextOfKinName: nextOfKinName.trim(),
        nextOfKinPhone: nextOfKinPhone.trim(),
      });
      if (outcome.alreadyImported) {
        setResult(outcome);
        return;
      }
      handleClose();
    } catch {
      // create.isError (already reflected by the mutation object) renders
      // the existing error message below — nothing further to do here.
    }
  }

  const previewData = preview.data;
  const canCreate =
    Boolean(previewData?.matchesConfig) &&
    !previewData?.alreadyAssociated &&
    Boolean(previewData?.historicalCaseNumber) &&
    !previewData?.historicalCaseNumberBlockedReason &&
    !previewData?.historicalDuplicateCaseId &&
    nextOfKinName.trim().length > 0 &&
    nextOfKinPhone.trim().length > 0 &&
    !result;

  return (
    <Modal open={open} onClose={handleClose} title="Import Existing Jotform Case">
      <h2 className="sx-modal-title" style={{ marginBottom: 16 }}>Import Existing Jotform Case</h2>
      <div>
        <p className="sx-help">
          Create a NEW Solis case from a real historical Jotform submission that has no existing Solis case at all —
          for the rare situation where a decedent was never entered into Solis before the Jotform integration went
          live.
        </p>
        <div className="sx-form-banner sx-form-banner-info" style={{ color: 'var(--sx-amber-text)', background: 'var(--sx-amber-bg)' }}>
          This will create a NEW Solis case. If this submission has its own legitimate Manors case number, that number is
          preserved — no normal production case number is consumed.
        </div>

        <div className="sx-form-section">
          <label className="sx-field">
            <span className="sx-label">Form</span>
            <select className="sx-select" value={formConfigId} onChange={(e) => { setFormConfigId(e.target.value); setResult(null); preview.reset(); }}>
              <option value="">Select a form…</option>
              {(configsQuery.data ?? []).map((config) => (
                <option key={config.id} value={config.id}>
                  {config.label}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <input
              type="text"
              className="sx-input"
              style={{ flex: 1 }}
              placeholder="Jotform submission ID"
              value={submissionId}
              onChange={(e) => { setSubmissionId(e.target.value); setResult(null); preview.reset(); }}
              aria-label="Jotform submission ID"
            />
            <button type="button" className="sx-btn sx-btn-secondary" onClick={handleLookUp} disabled={!formConfigId || !submissionId.trim() || preview.isPending}>
              Look up
            </button>
          </div>
        </div>

        {preview.isError && <div className="sx-error-state" role="alert">Could not retrieve that submission. Check the ID and try again.</div>}

        {previewData && (
          <>
            {!previewData.matchesConfig && (
              <div className="sx-form-banner sx-form-banner-error">This submission does not belong to the selected form. It cannot be used here.</div>
            )}
            {previewData.alreadyAssociated && (
              <div className="sx-form-banner sx-form-banner-error">
                This submission has already been imported{previewData.existingCaseId ? ' into an existing case' : ''}. It cannot be used to
                create another case.
              </div>
            )}

            {previewData.matchesConfig && !previewData.alreadyAssociated && (
              <>
                {previewData.historicalCaseNumberBlockedReason && (
                  <div className="sx-form-banner sx-form-banner-error">{previewData.historicalCaseNumberBlockedReason}</div>
                )}
                {previewData.historicalDuplicateCaseId && (
                  <div className="sx-form-banner sx-form-banner-error">
                    A Case already exists with this historical case number. Open the existing case and use the
                    existing-submission linking workflow instead.
                  </div>
                )}

                <div className="sx-form-section">
                  <div className="sx-form-section-title">Prefilled from Jotform</div>
                  <dl className="sx-kv">
                    <dt>Case Number</dt>
                    <dd>{previewData.historicalCaseNumber ?? '—'}</dd>
                    <dt>Decedent Name</dt>
                    <dd>{previewData.decedentName ?? '—'}</dd>
                    <dt>Date of Birth</dt>
                    <dd>{previewData.dateOfBirth ?? '—'}</dd>
                    <dt>Date of Death</dt>
                    <dd>{previewData.dateOfDeath ?? '—'}</dd>
                    <dt>Place of Death</dt>
                    <dd>{previewData.placeOfDeath ?? '—'}</dd>
                    <dt>Submitted</dt>
                    <dd>{previewData.submittedAt ? formatTimestamp(previewData.submittedAt) : '—'}</dd>
                  </dl>
                </div>

                <div className="sx-form-section" style={{ background: 'var(--sx-subtle)', borderRadius: 10, padding: '14px 16px', border: 'none' }}>
                  <div className="sx-form-section-title">Informant on File — Reference Only</div>
                  <p className="sx-help" style={{ fontStyle: 'italic' }}>
                    Informant is not automatically treated as Next of Kin.
                  </p>
                  <dl className="sx-kv">
                    <dt>Name</dt>
                    <dd>{previewData.informantName ?? '—'}</dd>
                    <dt>Relationship</dt>
                    <dd>{previewData.informantRelationship ?? '—'}</dd>
                    <dt>Phone</dt>
                    <dd>{previewData.informantPhone ?? '—'}</dd>
                    <dt>Is also Next of Kin?</dt>
                    <dd>{previewData.informantIsNextOfKin ?? '—'}</dd>
                  </dl>
                </div>

                <div className="sx-form-section">
                  <div className="sx-form-section-title">Next of Kin — Required</div>
                  <div className="sx-form-grid">
                    <label className="sx-field">
                      <span className="sx-label">Name</span>
                      <input type="text" className="sx-input" value={nextOfKinName} onChange={(e) => setNextOfKinName(e.target.value)} />
                    </label>
                    <label className="sx-field">
                      <span className="sx-label">Phone</span>
                      <input type="text" className="sx-input" value={nextOfKinPhone} onChange={(e) => setNextOfKinPhone(e.target.value)} />
                    </label>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {create.isError && <div className="sx-form-banner sx-form-banner-error">Case creation failed. Please try again.</div>}

        {result && (
          <p className="sx-help" style={{ color: 'var(--sx-green-text)' }}>
            {result.alreadyImported
              ? 'This submission was already imported previously — no new case was created.'
              : `Case ${result.caseNumber ?? result.caseId} created successfully.`}
          </p>
        )}
      </div>

      <div className="sx-modal-footer" style={{ padding: 0, border: 'none', height: 'auto', marginTop: 20 }}>
        <button type="button" className="sx-btn sx-btn-ghost" onClick={handleClose}>
          Cancel
        </button>
        <button type="button" className="sx-btn sx-btn-primary" onClick={handleCreate} disabled={!canCreate || create.isPending}>
          Create Case
        </button>
      </div>
    </Modal>
  );
}
