import type { AllCaseDataRow } from '../../services/allCaseDataReportService';

/**
 * Manors cleanup phase (Task #8, "All Case Data" report — PDF export).
 * Reuses the existing HTML->PDF pipeline (`lib/puppeteerDocumentRenderer.ts`,
 * already powering generated Statement/case documents) rather than a new
 * PDF library or hand-positioned `pdf-lib` text — same "one renderer,
 * HTML in, PDF out" architecture as every other generated document in
 * this codebase.
 *
 * The full dataset carries ~20 columns — unreadable as one desktop-width
 * table squeezed onto a page, and still awkward even in landscape. Rather
 * than shrink every column to illegibility, the PDF deliberately shows a
 * CURATED subset of the columns most useful printed/at-a-glance (case
 * identification, decedent/NOK contact basics, and the balance-due
 * figure) — the full field set (all columns) is always available via the
 * CSV/Excel export of the exact same filtered dataset; this PDF is a
 * reading/handoff artifact, not the canonical complete export. Landscape
 * A4 with a repeating header row (`<thead>`, which Chromium's print
 * engine repeats on every page automatically) so a long filtered result
 * set paginates cleanly instead of one unreadable continuous strip.
 */
const PDF_COLUMNS: ReadonlyArray<{ header: string; value: (row: AllCaseDataRow) => string }> = [
  { header: 'Case #', value: (r) => r.caseNumber },
  { header: 'Stage', value: (r) => r.stage },
  { header: 'Created', value: (r) => r.createdAt },
  { header: 'Decedent', value: (r) => r.decedentName },
  { header: 'DOB', value: (r) => r.dateOfBirth },
  { header: 'DOD', value: (r) => r.dateOfDeath },
  { header: 'Next of Kin', value: (r) => r.nextOfKinName },
  { header: 'NOK Phone', value: (r) => r.nextOfKinPhone },
  { header: 'Tag #', value: (r) => r.tagNumber },
  { header: 'Balance Due', value: (r) => r.balanceDue },
  { header: 'Payment Status', value: (r) => r.paymentStatus },
];

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildAllCaseDataPdfHtml(params: {
  organizationName: string;
  generatedAt: string;
  fromDate?: string;
  toDate?: string;
  rows: readonly AllCaseDataRow[];
}): string {
  const { organizationName, generatedAt, fromDate, toDate, rows } = params;
  const rangeLabel =
    fromDate || toDate
      ? `Created date ${fromDate ? `from ${fromDate}` : ''}${fromDate && toDate ? ' ' : ''}${toDate ? `through ${toDate}` : ''}`
      : 'All cases (no date filter applied)';

  const headerRow = `<tr>${PDF_COLUMNS.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')}</tr>`;
  const bodyRows = rows
    .map((row) => `<tr>${PDF_COLUMNS.map((c) => `<td>${escapeHtml(c.value(row))}</td>`).join('')}</tr>`)
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 9px; color: #222; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .meta { font-size: 10px; color: #555; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; white-space: nowrap; }
  th { background: #f0f0f0; font-weight: bold; }
  .footnote { margin-top: 10px; font-size: 8px; color: #777; }
</style>
</head>
<body>
  <h1>${escapeHtml(organizationName)} — All Case Data</h1>
  <div class="meta">${escapeHtml(rangeLabel)} · Generated ${escapeHtml(generatedAt)} · ${rows.length} case${rows.length === 1 ? '' : 's'}</div>
  <table>
    <thead>${headerRow}</thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="footnote">Showing a curated column subset for print readability. The full field set is available via the CSV or Excel export of this same report.</div>
</body>
</html>`;
}
