'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SelectField } from '@/components/ui/SelectField';
import { useMyPermissions } from '@/hooks/useRbac';
import { useCremationLabelState, useSaveCremationLabel, useSavedCremationLabel } from '@/hooks/useCremationLabel';
import { recordCremationLabelPrinted } from '@/lib/caseLabelClient';
import { buildCaseDocumentDownloadUrl } from '@/lib/caseDocumentsClient';
import { findDymoService, listDymoPrinters, printDymoLabel, renderDymoPreview, type DymoPrinter } from '@/lib/dymoConnect';
import { formatTimestamp } from '@/utils/format';
import type { ManorsLabelValues } from '@/domain/labels/manorsLabel';
import styles from './PrintLabelDialog.module.css';

/**
 * Cremation Label (2026-10). Saves Manors' approved DYMO label, filled with
 * the decedent's name, Tag # and Date of Cremation, to the case's documents
 * — no printer or DYMO Connect needed — and prints a SAVED label through
 * DYMO Connect on this computer. Print always sends the saved file's own
 * contents, never a fresh fill from the case: if the case changed since,
 * staff are told and choose whether to save a new version.
 *
 * Opened from the case header it shows the latest saved label; opened from
 * a row in the Documents tab (`documentId`) it shows that exact version.
 */
type DymoState =
  | { status: 'connecting' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; base: string; printers: DymoPrinter[] };

export function PrintLabelDialog({
  open,
  onClose,
  caseId,
  organizationId,
  documentId,
}: {
  open: boolean;
  onClose: () => void;
  caseId: string;
  organizationId: string;
  /** A specific saved version (from the Documents tab). */
  documentId?: string;
}) {
  const caseMode = documentId === undefined;
  const state = useCremationLabelState(organizationId, caseId, open && caseMode);
  const savedId = documentId ?? state.data?.latest?.documentId ?? null;
  const saved = useSavedCremationLabel(organizationId, caseId, savedId);
  const save = useSaveCremationLabel(organizationId, caseId);
  const permissionsQuery = useMyPermissions(organizationId);
  const canSave = !permissionsQuery.isSuccess || permissionsQuery.data.permissions.includes('document.generate');

  const [dymo, setDymo] = useState<DymoState>({ status: 'connecting' });
  const [printerName, setPrinterName] = useState('');
  const [preview, setPreview] = useState<{ xml: string; image: string } | null>(null);
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  // DYMO Connect is looked for once per opening. Saving never waits on it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDymo({ status: 'connecting' });
    (async () => {
      try {
        const base = await findDymoService();
        const printers = await listDymoPrinters(base);
        if (cancelled) return;
        setDymo({ status: 'ready', base, printers });
        setPrinterName((printers.find((p) => p.isConnected) ?? printers[0])?.name ?? '');
      } catch (error) {
        if (!cancelled) setDymo({ status: 'unavailable', message: error instanceof Error ? error.message : 'DYMO Connect is not available.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const current = caseMode ? state.data?.current : undefined;
  const latest = caseMode ? state.data?.latest : undefined;
  const savedFile = saved.data;
  // The label on screen: the saved one, or — before anything is saved — a
  // preview of what saving would store.
  const shownXml = savedFile?.labelXml ?? (caseMode && !latest && current?.ok ? current.labelXml : null);

  useEffect(() => {
    if (dymo.status !== 'ready' || !shownXml || preview?.xml === shownXml) return;
    let cancelled = false;
    renderDymoPreview(dymo.base, shownXml)
      .then((image) => !cancelled && setPreview({ xml: shownXml, image }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dymo, shownXml, preview?.xml]);

  const loading = (caseMode && state.isPending) || (savedId !== null && saved.isPending);
  const loadError = (caseMode && state.error) || saved.error;
  const changedSinceSaved = caseMode && latest && current?.ok && !state.data?.latestMatchesCase;
  const showSave = caseMode && canSave && current?.ok && (!latest || changedSinceSaved);
  const selectedPrinter = dymo.status === 'ready' ? dymo.printers.find((p) => p.name === printerName) : undefined;

  async function handleSave() {
    setNotice(null);
    try {
      const result = await save.mutateAsync(latest?.documentId ?? null);
      setNotice({ ok: true, message: result.outcome === 'saved' ? `Saved as Cremation Label v${result.version ?? 1} in this case's Documents.` : 'The saved label is already up to date.' });
    } catch (error) {
      setNotice({ ok: false, message: error instanceof Error ? error.message : 'The label could not be saved.' });
    }
  }

  async function handlePrint() {
    if (!savedFile || dymo.status !== 'ready' || !printerName) return;
    setPrinting(true);
    setNotice(null);
    try {
      await printDymoLabel(dymo.base, printerName, savedFile.labelXml);
    } catch (error) {
      setNotice({ ok: false, message: `${error instanceof Error ? error.message : 'The label could not be printed.'} The saved label is unchanged.` });
      setPrinting(false);
      return;
    }
    try {
      await recordCremationLabelPrinted(organizationId, caseId, savedFile.label.documentId, printerName);
      setNotice({ ok: true, message: `Sent to ${printerName}.` });
    } catch {
      setNotice({ ok: true, message: `Sent to ${printerName}. (The print could not be added to the case history.)` });
    }
    setPrinting(false);
  }

  const title = 'Cremation Label';
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">{title}</h2>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="sx-modal-body">
        {loading && <p className={styles.muted}>Loading the label…</p>}
        {loadError && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            {loadError.message}
          </div>
        )}

        {!loading && !loadError && (
          <>
            {savedFile ? (
              <p className={styles.savedLine}>
                <strong>Saved label{savedFile.label.version !== null ? ` v${savedFile.label.version}` : ''}</strong>
                {savedFile.isLatest ? <span className="sx-status sx-status-ok">Latest</span> : <span className="sx-status">Older version</span>}
                <span className={styles.muted}>
                  Saved by {savedFile.label.actorDisplayName ?? 'Unknown'} · {formatTimestamp(savedFile.label.createdAt)}
                </span>
              </p>
            ) : (
              caseMode && <p className={styles.savedLine}>No label has been saved for this case yet.</p>
            )}

            {shownXml && (preview?.xml === shownXml ? (
              <div className={styles.previewFrame}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL rendered by DYMO Connect; nothing for next/image to optimize */}
                <img className={styles.preview} src={preview.image} alt={labelAlt(savedFile?.values ?? (current?.ok ? current.values : null))} />
              </div>
            ) : (
              <LabelValues values={savedFile ? savedFile.values : current?.ok ? current.values : null} />
            ))}

            {caseMode && !latest && current?.ok && <p className={styles.muted}>Not saved yet — this is what will be saved.</p>}

            {changedSinceSaved && current?.ok && (
              <div className={`sx-form-banner ${styles.changed}`} role="status">
                The case&rsquo;s name, tag or Date of Cremation changed after this label was saved. Print still uses the saved label. Save a new version to print the
                current information: {current.values.name} · {current.values.tag} · {current.values.date}.
              </div>
            )}

            {caseMode && current && !current.ok && (
              <div className={`sx-form-banner ${latest ? 'sx-form-banner-info' : 'sx-form-banner-error'}`} role={latest ? 'status' : 'alert'}>
                {latest ? `A new version can't be saved yet: ${current.message}` : current.message}
              </div>
            )}

            {savedFile && dymo.status === 'connecting' && <p className={styles.muted}>Looking for DYMO Connect on this computer…</p>}
            {savedFile && dymo.status === 'unavailable' && (
              <div className="sx-form-banner sx-form-banner-info" role="status">
                {dymo.message} The saved label is kept as it is.
              </div>
            )}
            {savedFile && dymo.status === 'ready' && (
              <div className="sx-field">
                <label className="sx-label" htmlFor="print-label-printer">
                  Printer
                </label>
                {dymo.printers.length === 0 ? (
                  <p className={styles.muted}>DYMO Connect is running but sees no LabelWriter. Connect the printer, then reopen this window. The saved label is kept as it is.</p>
                ) : (
                  <SelectField id="print-label-printer" className="sx-select" value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
                    {dymo.printers.map((printer) => (
                      <option key={printer.name} value={printer.name}>
                        {printer.isConnected ? printer.name : `${printer.name} (not connected)`}
                      </option>
                    ))}
                  </SelectField>
                )}
                {selectedPrinter && !selectedPrinter.isConnected && (
                  <p className={styles.muted}>DYMO Connect reports this printer as not connected. Check that it is on and plugged in.</p>
                )}
              </div>
            )}

            {notice && (
              <div className={`sx-form-banner ${notice.ok ? 'sx-form-banner-info' : 'sx-form-banner-error'}`} role={notice.ok ? 'status' : 'alert'}>
                {notice.message}
              </div>
            )}
          </>
        )}
      </div>
      <div className="sx-modal-footer">
        <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
          Close
        </button>
        {savedFile && (
          <a className="sx-btn sx-btn-ghost" href={buildCaseDocumentDownloadUrl(organizationId, caseId, savedFile.label.documentId)}>
            Download .dymo
          </a>
        )}
        {showSave && (
          <button type="button" className={`sx-btn ${savedFile ? 'sx-btn-secondary' : 'sx-btn-primary'}`} onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : latest ? 'Save New Version' : 'Save Label'}
          </button>
        )}
        {savedFile && dymo.status === 'ready' && dymo.printers.length > 0 && (
          <button type="button" className="sx-btn sx-btn-primary" onClick={handlePrint} disabled={printing || !printerName}>
            {printing ? 'Printing…' : 'Print'}
          </button>
        )}
      </div>
    </Modal>
  );
}

function labelAlt(values: ManorsLabelValues | null): string {
  return values ? `Label preview: ${values.name}, ${values.tag}, ${values.date}` : 'Label preview';
}

function LabelValues({ values }: { values: ManorsLabelValues | null }) {
  if (!values) return null;
  return (
    <dl className={styles.values}>
      <dt>Name</dt>
      <dd>{values.name}</dd>
      <dt>Tag</dt>
      <dd>{values.tag}</dd>
      <dt>Date of Cremation</dt>
      <dd>{values.date}</dd>
    </dl>
  );
}
