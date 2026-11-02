'use client';

import { useEffect, useState } from 'react';
import { formatEmailAddress, parseEmail, type EmailAttachment, type ParsedEmail } from '@/domain/documents/emailMessage';
import styles from './EmailPreview.module.css';
import pdfStyles from './PdfViewer.module.css';

/**
 * In-app "View" for a saved email (.eml) on a case (2026-11): who sent it,
 * to whom, when, the subject, the message and its attachments. Everything
 * is shown as TEXT — the email's own HTML is never rendered, so nothing in
 * an email can run in SOLIS. Attachments can be downloaded; they are never
 * opened in the page.
 */
export function EmailPreview({ url, fileName }: { url: string; fileName: string }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; email: ParsedEmail } | { status: 'error' }>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const email = await parseEmail(await response.arrayBuffer());
        if (!cancelled) setState({ status: 'ready', email });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.status === 'loading') {
    return (
      <div className={pdfStyles.message} aria-busy="true">
        <p>Loading email…</p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={pdfStyles.message}>
        <p className={pdfStyles.errorText}>This email couldn&rsquo;t be shown.</p>
        <p className={pdfStyles.errorHint}>Use Download below to open {fileName} in your email program.</p>
      </div>
    );
  }

  const { email } = state;
  const rows: Array<[string, string]> = [
    ['From', email.from ? formatEmailAddress(email.from) : '—'],
    ['To', email.to.map(formatEmailAddress).join(', ') || '—'],
    ...(email.cc.length > 0 ? ([['Cc', email.cc.map(formatEmailAddress).join(', ')]] as Array<[string, string]>) : []),
    ...(email.replyTo.length > 0 ? ([['Reply-To', email.replyTo.map(formatEmailAddress).join(', ')]] as Array<[string, string]>) : []),
    ['Date', email.date ? new Date(email.date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'],
  ];

  return (
    <div className={styles.viewer}>
      <article className={styles.sheet} aria-label="Email">
        <h3 className={styles.subject}>{email.subject || '(no subject)'}</h3>
        <dl className={styles.headers}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {email.text ? <pre className={styles.body}>{email.text}</pre> : <p className={styles.empty}>This email has no message text.</p>}
        {email.attachments.length > 0 && (
          <section className={styles.attachments}>
            <h4 className={styles.attachmentsTitle}>Attachments ({email.attachments.length})</h4>
            <ul className={styles.attachmentList}>
              {email.attachments.map((attachment, index) => (
                <li key={`${attachment.fileName}-${index}`} className={styles.attachment}>
                  <span>{attachment.fileName}</span>
                  <span className={styles.attachmentSize}>{formatSize(attachment.size)}</span>
                  <button type="button" className={styles.attachmentButton} onClick={() => downloadAttachment(attachment)}>
                    Download
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Saves an attachment to the computer — as a download, never opened in
    the page (its content is whatever the sender attached). */
function downloadAttachment(attachment: EmailAttachment) {
  const blob = new Blob([attachment.content as BlobPart], { type: 'application/octet-stream' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = attachment.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}
