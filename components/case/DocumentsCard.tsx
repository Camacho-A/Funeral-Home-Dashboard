'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/Button';
import styles from './DocumentsCard.module.css';

export type DocumentRowItem = {
  id: string;
  name: string;
  status: string;
  meta?: string;
  onPrint: () => void;
  onRemove?: () => void;
};

/**
 * `documents` merges auto-required (stage-driven, from CaseViewModel) and
 * user-uploaded documents into one display list — that merge happens on the
 * page, since it's the one place both sources are available; this component
 * only knows how to render a row and doesn't care which source it came from.
 * `canRemove`/`onRemove` being present distinguishes uploaded rows, matching
 * design/support.js's `sc-if value="{{ d.remove }}"` guard.
 */
export function DocumentsCard({
  documents,
  onUploadFiles,
  onPrintAll,
}: {
  documents: DocumentRowItem[];
  onUploadFiles: (files: File[]) => void;
  onPrintAll: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onUploadFiles(files);
    event.target.value = '';
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.title}>Documents</div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.printLink} onClick={onPrintAll}>
            Print all
          </button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            + Upload
          </Button>
        </div>
      </div>
      <div className={styles.description}>
        Permits, certificates, pickup ID, payment invoices — kept on file for audit
      </div>
      <div className={styles.list}>
        {documents.map((doc) => (
          <div key={doc.id} className={styles.row}>
            <div className={styles.icon} />
            <div className={styles.info}>
              <div className={styles.name}>{doc.name}</div>
              {doc.meta && <div className={styles.meta}>{doc.meta}</div>}
            </div>
            <div className={styles.status}>{doc.status}</div>
            <button type="button" className={styles.rowPrintLink} onClick={doc.onPrint}>
              Print
            </button>
            {doc.onRemove && (
              <button type="button" className={styles.removeButton} onClick={doc.onRemove} aria-label={`Remove ${doc.name}`}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className={styles.hiddenFileInput}
      />
    </div>
  );
}
