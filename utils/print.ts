/**
 * Generic print-window helpers, ported from design/support.js's
 * printTextLog/printDoc. Domain-independent mechanics (opening a window,
 * writing markup, calling .print()) — what gets printed is decided by the
 * caller (CaseLogCard, ActivityLogCard, DocumentsCard).
 */

/**
 * Phase 16B (Case Number Generation): `caseNumber` is required (not
 * optional) — "include the Case Number on all... printable documents" —
 * and always the server-generated, read-only identifier
 * (types/case.ts's Case.caseNumber), never something typed into this
 * print flow itself.
 */
export function printTextLog<T>(
  title: string,
  caseName: string,
  caseNumber: string,
  entries: T[],
  renderEntry: (entry: T) => string,
): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const rows = entries.length
    ? entries.map(renderEntry).join('')
    : '<p style="color:#888">Nothing logged yet.</p>';

  printWindow.document.write(`<html><head><title>${title} — ${caseName} (${caseNumber})</title></head><body style="font-family:sans-serif;padding:60px">
    <h2>${title}</h2><p style="color:#555">Case: ${caseName} · Case #${caseNumber}</p>
    <div style="margin-top:24px">${rows}</div>
  </body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

/**
 * `file` accepts any `Blob` (a `File` is a `Blob`, so every existing
 * caller — an `<input type="file">`'s picked File — still works
 * unchanged) — widened for `printStoredDocument` below, which fetches a
 * real, private CaseDocument's bytes into a plain `Blob`, never a `File`.
 */
export function printFile(file: Blob | undefined, docName: string, caseName: string, caseNumber: string): void {
  if (file) {
    const url = URL.createObjectURL(file);
    const printWindow = window.open(url, '_blank');
    printWindow?.addEventListener('load', () => printWindow.print());
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`<html><head><title>${docName}</title></head><body style="font-family:sans-serif;padding:60px">
    <h2>${docName}</h2><p>Case: ${caseName} · Case #${caseNumber}</p>
    <p style="color:#888">Placeholder — attach or scan the physical copy of this document for the case file.</p>
  </body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

/**
 * Case Detail tabs migration (2026-09, item #2). Prints a real, private
 * `CaseDocument` by fetching it through the *same* authorized download
 * route `CaseDocumentsTab`'s own "Download" link already uses
 * (`GET /api/cases/[caseId]/documents/[documentId]/download` —
 * session-cookie-gated, re-checks `document.view`, streams bytes directly,
 * never a Blob/signed URL server-side). The `URL.createObjectURL` here is
 * the same client-side-only, ephemeral mechanism `printFile`'s real-file
 * branch already uses for a locally-picked upload — nothing is exposed
 * beyond what clicking "Download" already exposes to this same
 * authenticated browser tab. Throws on a non-OK response (expired
 * session, revoked access, deleted document) so the caller can show a
 * real error instead of silently printing nothing or a misleading
 * placeholder page.
 */
export async function printStoredDocument(url: string, docName: string, caseName: string, caseNumber: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Couldn't retrieve "${docName}" to print (status ${response.status}).`);
  }
  const blob = await response.blob();
  printFile(blob, docName, caseName, caseNumber);
}
