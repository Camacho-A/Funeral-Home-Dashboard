'use client';

import { resolveDocumentPreviewKind } from '@/domain/documents/documentPreview';
import { PdfViewer } from './PdfViewer';
import styles from './PdfViewer.module.css';

/**
 * The in-app "View" surface for a stored case document (2026-10).
 *
 * Dispatches on what the document actually is: PDFs go to SOLIS's own
 * renderer, images render directly, and a Word document says plainly that
 * it cannot be shown in a browser instead of presenting an empty frame.
 */
export function DocumentPreview({
  url,
  fileName,
  mimeType,
}: {
  url: string;
  fileName: string;
  mimeType: string | null | undefined;
}) {
  const kind = resolveDocumentPreviewKind(mimeType, fileName);

  if (kind === 'pdf') {
    return <PdfViewer url={url} fileName={fileName} />;
  }

  if (kind === 'image') {
    return (
      <div className={styles.canvasScroll} style={{ maxHeight: '70vh' }}>
        {/* A stored upload of unknown dimensions — next/image would need
            them, and this is a one-off modal, not a page asset. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={fileName} className={styles.canvas} style={{ maxWidth: '100%', height: 'auto' }} />
      </div>
    );
  }

  return (
    <div className={styles.message}>
      <p className={styles.errorText}>This file type can&rsquo;t be shown in the browser.</p>
      <p className={styles.errorHint}>Use Download below to open {fileName} on your computer.</p>
    </div>
  );
}
