/**
 * Generic print-window helpers, ported from design/support.js's
 * printTextLog/printDoc. Domain-independent mechanics (opening a window,
 * writing markup, calling .print()) — what gets printed is decided by the
 * caller (CaseLogCard, ActivityLogCard, DocumentsCard).
 */

export function printTextLog<T>(
  title: string,
  caseName: string,
  entries: T[],
  renderEntry: (entry: T) => string,
): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const rows = entries.length
    ? entries.map(renderEntry).join('')
    : '<p style="color:#888">Nothing logged yet.</p>';

  printWindow.document.write(`<html><head><title>${title} — ${caseName}</title></head><body style="font-family:sans-serif;padding:60px">
    <h2>${title}</h2><p style="color:#555">Case: ${caseName}</p>
    <div style="margin-top:24px">${rows}</div>
  </body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export function printFile(file: File | undefined, docName: string, caseName: string): void {
  if (file) {
    const url = URL.createObjectURL(file);
    const printWindow = window.open(url, '_blank');
    printWindow?.addEventListener('load', () => printWindow.print());
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`<html><head><title>${docName}</title></head><body style="font-family:sans-serif;padding:60px">
    <h2>${docName}</h2><p>Case: ${caseName}</p>
    <p style="color:#888">Placeholder — attach or scan the physical copy of this document for the case file.</p>
  </body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
