'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { DocumentPreview } from '@/components/documents/DocumentPreview';
import { caseDocumentsKey } from '@/hooks/useCaseDocumentLibrary';
import { fetchManateeDraft, previewManateeApplication, saveManateeApplication } from '@/lib/manateeApplicationClient';
import {
  FORM_RELATIONSHIP_OPTIONS,
  formatMoney,
  manateeFees,
  manateeIssues,
  normalizeSsn,
  type ManateeApplicationInput,
  type ManateeDraftValues,
  type ManateeValueSource,
} from '@/domain/documents/manateeDeathCertificateApplication';
import { formatDateInput } from '@/utils/inputMask';
import styles from './ManateeApplicationDialog.module.css';

/**
 * Manatee County — Death Certificate Application (2026-10). Staff review
 * what SOLIS found for the case, fill in or correct anything, choose the
 * certificates, preview the filled form, and save it to the case's
 * documents. Corrections here go into this document only — never back
 * into the case.
 *
 * The SSN on file is never sent to this window: it shows only its last
 * four digits. Typing a number here uses that number instead.
 */

const SOURCE_LABEL: Record<Exclude<ManateeValueSource, null>, string> = {
  arrangement_form: 'From the Arrangement Form',
  vital_statistics: 'From the Vital Statistics form',
  first_call_sheet: 'From the First Call Sheet',
  case: 'From the case',
  city: 'Matched to the city — please confirm',
};

type TextKey = Exclude<keyof ManateeDraftValues, 'withCause' | 'withoutCause' | 'fedexFee' | 'ssnNotKnown'>;

export function ManateeApplicationDialog({ organizationId, caseId, onClose }: { organizationId: string; caseId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const draft = useQuery({ queryKey: ['manateeApplication', organizationId, caseId], queryFn: () => fetchManateeDraft(organizationId, caseId), gcTime: 0, staleTime: 0 });

  const [values, setValues] = useState<ManateeDraftValues | null>(null);
  const [typedSsn, setTypedSsn] = useState('');
  const [step, setStep] = useState<'review' | 'preview' | 'saved'>('review');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft.data && !values) setValues(draft.data.values);
  }, [draft.data, values]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const ssnOnFile = draft.data?.ssn.onFile ?? false;
  const input: ManateeApplicationInput | null = values ? { ...values, ssn: typedSsn.trim() ? typedSsn : null } : null;
  // The number on file is checked on the server; here it only counts as present.
  const issues = useMemo(
    () => (values ? manateeIssues({ ...values, ssn: typedSsn.trim() ? typedSsn : ssnOnFile ? '000000000' : null }) : []),
    [values, typedSsn, ssnOnFile],
  );
  const typedSsnInvalid = typedSsn.trim() !== '' && !normalizeSsn(typedSsn);
  const fees = values ? manateeFees(values.withCause, values.withoutCause, values.fedexFee) : null;
  const templateReady = draft.data?.template === 'available';
  const canContinue = Boolean(values) && issues.length === 0 && !typedSsnInvalid && templateReady && busy === null;

  const set = <K extends keyof ManateeDraftValues>(key: K, value: ManateeDraftValues[K]) => setValues((v) => (v ? { ...v, [key]: value } : v));
  const issueFor = (key: keyof ManateeDraftValues | 'ssn') => issues.find((i) => i.field === key)?.message;

  async function showPreview() {
    if (!input) return;
    setBusy('preview');
    setError(null);
    try {
      const blob = await previewManateeApplication(organizationId, caseId, input);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The preview could not be made.');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!input) return;
    setBusy('save');
    setError(null);
    try {
      await saveManateeApplication(organizationId, caseId, input);
      await queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, caseId) });
      setStep('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The application could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  const text = (key: TextKey, label: string, opts: { required?: boolean; placeholder?: string; list?: string; date?: boolean } = {}) => {
    const message = issueFor(key);
    const source = draft.data?.sources[key];
    return (
      <div className="sx-field">
        <label className={`sx-label ${opts.required ? 'sx-label-required' : ''}`} htmlFor={`manatee-${key}`}>
          {label}
        </label>
        <input
          id={`manatee-${key}`}
          className="sx-input"
          value={values?.[key] ?? ''}
          placeholder={opts.placeholder}
          list={opts.list}
          inputMode={opts.date ? 'numeric' : undefined}
          aria-invalid={message ? true : undefined}
          onChange={(e) => set(key, opts.date ? formatDateInput(e.target.value) : e.target.value)}
        />
        {message ? <span className={styles.issue}>{message}</span> : source ? <span className="sx-help">{SOURCE_LABEL[source]}</span> : null}
      </div>
    );
  };

  const quantity = (key: 'withCause' | 'withoutCause', label: string, totalCents: number) => (
    <div className={styles.feeRow}>
      <label className={styles.feeLabel} htmlFor={`manatee-${key}`}>
        {label}
      </label>
      <input
        id={`manatee-${key}`}
        className={`sx-input ${styles.qty}`}
        type="number"
        min={0}
        max={draft.data?.pricing.maxPerLine}
        step={1}
        inputMode="numeric"
        value={values ? String(values[key]) : ''}
        aria-invalid={issueFor(key) ? true : undefined}
        onChange={(e) => set(key, e.target.value === '' ? 0 : Number(e.target.value))}
      />
      <span className={styles.feeMath}>× $8.00</span>
      <span className={styles.feeTotal}>${formatMoney(totalCents)}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Manatee County — Death Certificate Application" size="lg">
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">Manatee County — Death Certificate Application</h2>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="sx-modal-body">
        {draft.isLoading && <p className="sx-help">Looking up this case&rsquo;s information…</p>}
        {draft.isError && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            {draft.error instanceof Error ? draft.error.message : 'Could not load the application.'}
          </div>
        )}
        {draft.data && !templateReady && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            The Manatee County form is not set up yet. Ask an administrator to add it.
          </div>
        )}
        {error && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            {error}
          </div>
        )}

        {step === 'saved' && (
          <div className="sx-form-banner sx-form-banner-info" role="status">
            Saved to this case&rsquo;s documents as &ldquo;Manatee County Death Certificate Application&rdquo;. Download or print it from the
            Documents list. It has not been sent anywhere.
          </div>
        )}

        {step === 'preview' && previewUrl && (
          <div className={styles.preview}>
            <DocumentPreview url={previewUrl} fileName="Manatee County Death Certificate Application.pdf" mimeType="application/pdf" />
          </div>
        )}

        {step === 'review' && values && (
          <>
            {draft.data?.latest && (
              <p className="sx-help">
                Saved before as version {draft.data.latest.version}. Saving again keeps that version in History.
              </p>
            )}
            <p className="sx-help">Changes here go into this document only — the case is not changed.</p>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Section A — Decedent</h3>
              <div className={styles.grid3}>
                {text('decedentFirst', 'First name', { required: true })}
                {text('decedentMiddle', 'Middle name')}
                {text('decedentLast', 'Last name', { required: true })}
              </div>
              <div className={styles.grid3}>
                {text('dateOfDeath', 'Date of death', { required: true, placeholder: 'MM/DD/YYYY', date: true })}
                {text('placeOfDeathCity', 'City or town of death', { required: true })}
                {text('placeOfDeathCounty', 'County of death', { required: true })}
              </div>
              <div className="sx-field">
                <label className="sx-label sx-label-required" htmlFor="manatee-ssn">
                  Social Security number
                </label>
                {ssnOnFile && !values.ssnNotKnown && (
                  <span className="sx-help">
                    On file: {draft.data?.ssn.masked}
                    {draft.data?.ssn.source && draft.data.ssn.source !== 'case' && draft.data.ssn.source !== 'city' ? ` · ${SOURCE_LABEL[draft.data.ssn.source]}` : ''}
                  </span>
                )}
                {!values.ssnNotKnown && (
                  <input
                    id="manatee-ssn"
                    className="sx-input"
                    autoComplete="off"
                    inputMode="numeric"
                    placeholder={ssnOnFile ? 'Type a different number to use it instead' : '###-##-####'}
                    value={typedSsn}
                    aria-invalid={typedSsnInvalid || issueFor('ssn') ? true : undefined}
                    onChange={(e) => setTypedSsn(e.target.value)}
                  />
                )}
                {typedSsnInvalid && <span className={styles.issue}>A Social Security number has 9 digits.</span>}
                {!typedSsnInvalid && issueFor('ssn') && <span className={styles.issue}>{issueFor('ssn')}</span>}
                <label className={styles.check}>
                  <input type="checkbox" checked={values.ssnNotKnown} onChange={(e) => set('ssnNotKnown', e.target.checked)} />
                  Not known — leave the box blank
                </label>
              </div>
              <h4 className={styles.subTitle}>Surviving spouse (if applicable and known)</h4>
              <div className={styles.grid3}>
                {text('spouseFirst', 'First name')}
                {text('spouseMiddle', 'Middle name')}
                {text('spouseLast', 'Last name (maiden, if applicable)')}
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Section B — Person represented</h3>
              <p className="sx-help">The applicant — Gus Camacho Jr., Funeral Director — is already printed on the form and is not changed.</p>
              <div className={styles.grid2}>
                {text('representedName', 'Next of kin', { required: true })}
                {text('representedRelationship', 'Relationship to the decedent', { required: true, list: 'manatee-relationships' })}
              </div>
              <datalist id="manatee-relationships">
                {FORM_RELATIONSHIP_OPTIONS.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Section C — Certificates and fees</h3>
              {fees && (
                <>
                  {quantity('withCause', 'With cause of death', fees.withCauseTotalCents)}
                  {quantity('withoutCause', 'Without cause of death', fees.withoutCauseTotalCents)}
                  <div className={styles.feeRow}>
                    <label className={`${styles.feeLabel} ${styles.check}`}>
                      <input type="checkbox" checked={values.fedexFee} onChange={(e) => set('fedexFee', e.target.checked)} />
                      FedEx fee applies
                    </label>
                    <span />
                    <span className={styles.feeMath}>$15.00</span>
                    <span className={styles.feeTotal}>${formatMoney(fees.fedexCents)}</span>
                  </div>
                  <div className={`${styles.feeRow} ${styles.grandTotal}`}>
                    <span className={styles.feeLabel}>Grand total</span>
                    <span />
                    <span />
                    <span className={styles.feeTotal}>${formatMoney(fees.grandTotalCents)}</span>
                  </div>
                  {(issueFor('withCause') || issueFor('withoutCause')) && <span className={styles.issue}>{issueFor('withCause') ?? issueFor('withoutCause')}</span>}
                </>
              )}
            </section>

            {issues.length > 0 && (
              <div className="sx-form-banner sx-form-banner-error" role="status">
                {issues.length === 1 ? '1 item needs' : `${issues.length} items need`} your review before the form can be made.
              </div>
            )}
          </>
        )}
      </div>
      <div className="sx-modal-footer">
        <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
          {step === 'saved' ? 'Close' : 'Cancel'}
        </button>
        {step === 'review' && (
          <button type="button" className="sx-btn sx-btn-primary" disabled={!canContinue} onClick={showPreview}>
            {busy === 'preview' ? 'Preparing preview…' : 'Preview'}
          </button>
        )}
        {step === 'preview' && (
          <>
            <button type="button" className="sx-btn sx-btn-ghost" disabled={busy !== null} onClick={() => setStep('review')}>
              Back to edit
            </button>
            <button type="button" className="sx-btn sx-btn-primary" disabled={busy !== null} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save to Documents'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
